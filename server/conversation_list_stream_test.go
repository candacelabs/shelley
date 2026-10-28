package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"shelley.exe.dev/db"
)

func TestConversationStreamIncludesListPatchInitialReset(t *testing.T) {
	t.Parallel()
	server, database, _ := newTestServer(t)

	conversation, err := database.CreateConversation(t.Context(), strPtr("current"), true, nil, nil, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateConversation(t.Context(), strPtr("other"), true, nil, nil, db.ConversationOptions{}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	rec := newFlusherRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/stream2?conversation="+conversation.ConversationID, nil).WithContext(ctx)
	done := make(chan struct{})
	go func() {
		server.handleStream(rec, req)
		close(done)
	}()

	patch := waitForConversationStreamListPatch(t, rec, "")
	if !patch.Reset || patch.OldHash != nil || patch.NewHash == "" {
		t.Fatalf("expected initial reset patch, got %+v", patch)
	}
	state := mustApplyPatch(t, nil, patch.Patch)
	if len(state) != 2 {
		t.Fatalf("expected reset list with 2 conversations, got %d", len(state))
	}
	verifyHash(t, state, patch.NewHash)

	cancel()
	<-done
}

func TestConversationStreamListPatchReplaysFromHash(t *testing.T) {
	t.Parallel()
	server, database, _ := newTestServer(t)

	conversation, err := database.CreateConversation(t.Context(), strPtr("current"), true, nil, nil, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}

	patchCtx, patchCancel := context.WithCancel(t.Context())
	patchRec := newFlusherRecorder()
	patchReq := httptest.NewRequest(http.MethodGet, "/api/stream2", nil).WithContext(patchCtx)
	patchDone := make(chan struct{})
	go func() {
		server.handleStream(patchRec, patchReq)
		close(patchDone)
	}()
	initial := waitForPatchEventAfter(t, patchRec, "")
	for _, slug := range []string{"one", "two"} {
		if _, err := database.CreateConversation(t.Context(), strPtr(slug), true, nil, nil, db.ConversationOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	patchCancel()
	<-patchDone

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	rec := newFlusherRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/stream2?conversation="+conversation.ConversationID+"&conversation_list_hash="+initial.NewHash, nil).WithContext(ctx)
	done := make(chan struct{})
	go func() {
		server.handleStream(rec, req)
		close(done)
	}()

	first := waitForConversationStreamListPatch(t, rec, initial.NewHash)
	second := waitForConversationStreamListPatch(t, rec, first.NewHash)
	if first.Reset || second.Reset {
		t.Fatalf("expected replay patches, got %+v then %+v", first, second)
	}
	if first.OldHash == nil || *first.OldHash != initial.NewHash {
		t.Fatalf("first patch should start at initial hash, got %+v", first)
	}
	if second.OldHash == nil || *second.OldHash != first.NewHash {
		t.Fatalf("second patch should chain from first, got %+v", second)
	}

	cancel()
	<-done
}

func TestConversationStreamListPatchCurrentHashSkipsInitialAndStreamsLive(t *testing.T) {
	t.Parallel()
	server, database, _ := newTestServer(t)

	conversation, err := database.CreateConversation(t.Context(), strPtr("current"), true, nil, nil, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := server.conversationListStream.recompute(t.Context()); err != nil {
		t.Fatal(err)
	}
	currentHash := server.conversationListStream.currentHash

	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	rec := newFlusherRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/stream2?conversation="+conversation.ConversationID+"&conversation_list_hash="+currentHash, nil).WithContext(ctx)
	done := make(chan struct{})
	go func() {
		server.handleStream(rec, req)
		close(done)
	}()

	waitForConversationStreamData(t, rec)
	// The contract for a matching conversation_list_hash is "don't replay
	// the world": no reset and no spurious full-list patches. Background
	// recomputes between the test's hash capture and the server's connect
	// may emit a benign forward patch from currentHash if internal writes
	// happened (e.g. system prompt hydration) — that's fine as long as it
	// is NOT a reset.
	for _, ev := range parseConversationStreamListPatches(rec.getString()) {
		if ev.Reset {
			t.Fatalf("did not expect initial reset for current hash, got %+v", ev)
		}
		if ev.OldHash == nil || *ev.OldHash != currentHash {
			t.Fatalf("unexpected initial patch with non-current OldHash; got %+v", ev)
		}
		currentHash = ev.NewHash
	}

	if _, err := database.CreateConversation(t.Context(), strPtr("newer"), true, nil, nil, db.ConversationOptions{}); err != nil {
		t.Fatal(err)
	}
	patch := waitForConversationStreamListPatch(t, rec, currentHash)
	if patch.Reset || patch.OldHash == nil || *patch.OldHash != currentHash {
		t.Fatalf("expected live patch from current hash, got %+v", patch)
	}

	cancel()
	<-done
}

// streamWaitTimeout is generous on purpose: the per-conversation stream
// handler runs Hydrate before its first flush, which on a cold cache shells
// out to git and walks the working tree for guidance files. Under -race on
// a loaded CI worker that has been observed to take several seconds, so a
// 2s ceiling produced flakes (e.g. Buildkite #2891).
const streamWaitTimeout = 30 * time.Second

func waitForConversationStreamData(t *testing.T, rec *flusherRecorder) {
	t.Helper()
	timer := time.NewTimer(streamWaitTimeout)
	defer timer.Stop()
	for {
		if strings.Contains(rec.getString(), "\n\n") {
			return
		}
		select {
		case <-rec.flushed:
		case <-timer.C:
			t.Fatalf("timed out waiting for conversation stream data; body=%s", rec.getString())
		}
	}
}

func waitForConversationStreamListPatch(t *testing.T, rec *flusherRecorder, prevHash string) ConversationListPatchEvent {
	t.Helper()
	timer := time.NewTimer(streamWaitTimeout)
	defer timer.Stop()
	for {
		for _, ev := range parseConversationStreamListPatches(rec.getString()) {
			if (prevHash == "" && (ev.OldHash == nil || *ev.OldHash == "" || ev.Reset)) ||
				(prevHash != "" && ev.OldHash != nil && *ev.OldHash == prevHash) {
				return ev
			}
		}
		select {
		case <-rec.flushed:
		case <-timer.C:
			t.Fatalf("timed out waiting for conversation_list_patch after %q; body=%s", prevHash, rec.getString())
		}
	}
}

func parseConversationStreamListPatches(body string) []ConversationListPatchEvent {
	var events []ConversationListPatchEvent
	for _, part := range strings.Split(body, "\n\n") {
		for _, line := range strings.Split(part, "\n") {
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var response StreamResponse
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &response); err != nil {
				continue
			}
			if response.ConversationListPatch != nil {
				events = append(events, *response.ConversationListPatch)
			}
		}
	}
	return events
}
