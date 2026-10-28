package server

import (
	"testing"
	"time"

	"shelley.exe.dev/db"
)

// A subagent asked to work without a named model keeps its own model, even
// when its parent uses another; a new subagent inherits the parent's model.
func TestRunSubagentKeepsItsOwnModel(t *testing.T) {
	server, database, _ := newTestServer(t)
	held := newHeldLLMService()
	server.llmManager = &twoModelLLMManager{service: held}
	t.Cleanup(func() { stopActiveConversationLoops(server) })
	runner := NewSubagentRunner(server)

	parent, err := database.CreateConversation(t.Context(), nil, true, nil, strPtr("model-a"), db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateSubagentConversation(t.Context(), "scout", parent.ConversationID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runner.RunSubagent(t.Context(), child.ConversationID, "first", "model-b", ""); err != nil {
		t.Fatal(err)
	}
	held.waitCall(t, parentMessage(parent, "first")).Release()
	waitFor(t, 5*time.Second, func() bool { return !server.IsAgentWorking(child.ConversationID) })

	if _, err := runner.RunSubagent(t.Context(), child.ConversationID, "second", "", ""); err != nil {
		t.Fatal(err)
	}
	held.waitCall(t, parentMessage(parent, "second")).Release()
	if got := conversationModel(t, database, child.ConversationID); got != "model-b" {
		t.Fatalf("resumed subagent model = %q, want model-b", got)
	}

	fresh, err := database.CreateSubagentConversation(t.Context(), "fresh", parent.ConversationID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := runner.RunSubagent(t.Context(), fresh.ConversationID, "third", "", ""); err != nil {
		t.Fatal(err)
	}
	held.waitCall(t, parentMessage(parent, "third")).Release()
	if got := conversationModel(t, database, fresh.ConversationID); got != "model-a" {
		t.Fatalf("new subagent model = %q, want parent's model-a", got)
	}
}

func conversationModel(t *testing.T, database *db.DB, conversationID string) string {
	t.Helper()
	conv, err := database.GetConversationByID(t.Context(), conversationID)
	if err != nil {
		t.Fatal(err)
	}
	return derefString(conv.Model)
}
