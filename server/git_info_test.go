package server

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"shelley.exe.dev/claudetool"
	"shelley.exe.dev/db"
	"shelley.exe.dev/llm/predictable"
)

// TestGitInfoForCommitInOtherRepo checks that a commit made by a bash command
// that cds into another repository is announced for that repository, while
// the conversation's working directory stays put.
func TestGitInfoForCommitInOtherRepo(t *testing.T) {
	t.Parallel()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	home, other := filepath.Join(root, "home"), filepath.Join(root, "other")
	for _, dir := range []string{home, other} {
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		runGit(t, dir, "init", "-q", "-b", "main")
		runGit(t, dir, "config", "user.email", "test@test.com")
		runGit(t, dir, "config", "user.name", "Test")
		runGit(t, dir, "commit", "-q", "--allow-empty", "-m", "initial")
	}

	database, cleanup := setupTestDB(t)
	defer cleanup()
	server := NewServer(database, &testLLMManager{service: predictable.NewService()}, claudetool.ToolSetConfig{WorkingDir: home}, slog.Default(), true, "predictable", "")
	conversation, err := database.CreateConversation(t.Context(), nil, true, &home, nil, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	id := conversation.ConversationID

	postChatMessage(t, server, id, "bash: cd "+other+" && git commit -q --allow-empty -m elsewhere")
	waitForIdle(t, server, id)
	// A read-only git command elsewhere announces nothing.
	postChatMessage(t, server, id, "bash: cd "+other+" && git log -1")
	waitForIdle(t, server, id)

	messages, err := database.ListMessagesByType(t.Context(), id, db.MessageTypeGitInfo)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 || messages[0].UserData == nil {
		t.Fatalf("want one gitinfo message, got %#v", messages)
	}
	var info GitInfoUserData
	if err := json.Unmarshal([]byte(*messages[0].UserData), &info); err != nil {
		t.Fatal(err)
	}
	if info.Worktree != other || info.Branch != "main" || info.Subject != "elsewhere" {
		t.Errorf("gitinfo = %+v, want the commit in %s", info, other)
	}
	conversation, err = database.GetConversationByID(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	if conversation.Cwd == nil || *conversation.Cwd != home {
		t.Errorf("cwd = %v, want %s", conversation.Cwd, home)
	}
}
