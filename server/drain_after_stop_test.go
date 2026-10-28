package server

import (
	"path/filepath"
	"testing"
	"time"

	"shelley.exe.dev/claudetool"
	"shelley.exe.dev/db"
	"shelley.exe.dev/llm"
)

// A conversation stopped mid-turn still receives a background job's later
// completion notice: stopping a turn does not lose the conversation's model.
func TestBackgroundJobNoticeAfterStop(t *testing.T) {
	server, database, _ := newTestServer(t)
	held := newHeldLLMService()
	server.llmManager = &twoModelLLMManager{service: held}
	t.Cleanup(func() { stopActiveConversationLoops(server) })

	conv, err := database.CreateConversation(t.Context(), nil, true, nil, strPtr("model-a"), db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	manager, err := server.getOrCreateConversationManager(t.Context(), conv.ConversationID, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.AcceptUserMessage(t.Context(), held, "model-a", llm.UserStringMessage("long task")); err != nil {
		t.Fatal(err)
	}
	held.waitCall(t, "long task") // never released; the cancel ends it
	dir := t.TempDir()
	job := claudetool.BackgroundJob{
		ID:             "job1",
		ConversationID: conv.ConversationID,
		Command:        "make build",
		LogPath:        filepath.Join(dir, "job1.log"),
		ExitPath:       filepath.Join(dir, "job1.exit"),
		StartedAt:      time.Now(),
	}
	// A running job holds the end-of-turn notification.
	if err := server.recordBackgroundJob(t.Context(), job); err != nil {
		t.Fatal(err)
	}
	cancelConversation(t, server, conv.ConversationID)

	if err := server.reportBackgroundJobExit(t.Context(), job); err != nil {
		t.Fatal(err)
	}
	notice := `<background_job id="job1">` + "\n" + xmlProvenanceText(job.Outcome().Notice()) + "\n</background_job>"
	held.waitCall(t, notice).Release()
}
