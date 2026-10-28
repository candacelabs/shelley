package db

import (
	"testing"
	"time"

	"shelley.exe.dev/llm"
)

func TestCommitTourWorkerLifecycle(t *testing.T) {
	database, cleanup := NewTestDB(t)
	defer cleanup()
	cwd := t.TempDir()
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &cwd, &model, ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateCommitTourWorker(t.Context(), parent.ConversationID, cwd, model, ConversationOptions{
		Kind: CommitTourKind,
		CommitTour: &CommitTourRequest{
			Repository:  cwd + "/.git",
			Worktree:    cwd,
			Commit:      "0123456789abcdef0123456789abcdef01234567",
			State:       "building",
			RequestedAt: time.Now().UTC(),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	request, ok := ManagedCommitTourRequest(*child)
	if !ok || request.State != "building" {
		t.Fatalf("managed request = %#v, %v", request, ok)
	}
	workers, err := database.ListCommitTourWorkers(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if len(workers) != 1 || workers[0].ConversationID != child.ConversationID {
		t.Fatalf("workers = %#v", workers)
	}
	if _, err := database.UpdateCommitTourWorker(t.Context(), child.ConversationID, func(request *CommitTourRequest) {
		request.State = "failed"
		request.Error = "no tour"
	}); err != nil {
		t.Fatal(err)
	}
	updated, err := database.GetConversationByID(t.Context(), child.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	request, ok = ManagedCommitTourRequest(*updated)
	if !ok || request.State != "failed" || request.Error != "no tour" {
		t.Fatalf("updated request = %#v, %v", request, ok)
	}
	if _, err := database.CreateMessage(t.Context(), CreateMessageParams{
		ConversationID: child.ConversationID,
		Type:           MessageTypeUser,
		LLMData:        llm.UserStringMessage("inspect the tour"),
	}); err != nil {
		t.Fatal(err)
	}
	forked, err := database.ForkConversation(t.Context(), child.ConversationID, 1)
	if err != nil {
		t.Fatal(err)
	}
	forkedOptions := ParseConversationOptions(forked.ConversationOptions)
	if forkedOptions.Kind != "" || forkedOptions.CommitTour != nil {
		t.Fatalf("fork retained managed tour options: %#v", forkedOptions)
	}

	planned, err := database.PlanConversationDeletion(t.Context(), parent.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(planned) != 1 || planned[0] != child.ConversationID {
		t.Fatalf("planned children = %#v", planned)
	}
	deleted, err := database.DeleteConversationWithBtwReaders(t.Context(), parent.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0] != child.ConversationID {
		t.Fatalf("deleted children = %#v", deleted)
	}
}
