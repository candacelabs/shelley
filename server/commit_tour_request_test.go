package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"shelley.exe.dev/committour"
	"shelley.exe.dev/db"
	"shelley.exe.dev/llm"
)

func commitTourTestHash(t *testing.T, repo string) string {
	t.Helper()
	out, err := exec.Command("git", "-C", repo, "rev-parse", "HEAD").Output()
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(string(out))
}

func attachCommitTourTestNote(t *testing.T, repo, hash string) {
	t.Helper()
	_, fragments, err := committour.Chunks(repo, hash)
	if err != nil {
		t.Fatal(err)
	}
	tour := committour.Tour{Version: 1, Title: "Requested tour"}
	for _, fragment := range fragments {
		tour.Chunks = append(tour.Chunks, committour.TourChunk{Patch: fragment, Trivial: true})
	}
	note, err := json.Marshal(tour)
	if err != nil {
		t.Fatal(err)
	}
	if err := committour.WriteNote(repo, hash, note); err != nil {
		t.Fatal(err)
	}
}

func commitTourJobDone(t *testing.T, server *Server, repository, hash string) <-chan struct{} {
	t.Helper()
	server.commitTourMu.Lock()
	defer server.commitTourMu.Unlock()
	job := server.commitTourJobs[repository+"\x00"+hash]
	if job == nil {
		t.Fatal("commit tour job is not registered")
	}
	return job.done
}

func TestParseCommitTourCommand(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		message string
		hash    string
		cwd     string
		ok      bool
		err     bool
	}{
		{"/tour abc1234", "abc1234", "", true, false},
		{"  /tour\tabc1234\n/tmp/a repo  ", "abc1234", "/tmp/a repo", true, false},
		{"/tour", "", "", true, false},
		{"/tour  ", "", "", true, false},
		{"/tour abc1234 extra", "", "", true, true},
		{"/tourx abc1234", "", "", false, false},
		{"please /tour abc1234", "", "", false, false},
	} {
		hash, cwd, ok, err := parseCommitTourCommand(tc.message)
		if hash != tc.hash || cwd != tc.cwd || ok != tc.ok || (err != nil) != tc.err {
			t.Errorf("parseCommitTourCommand(%q) = %q, %q, %v, %v", tc.message, hash, cwd, ok, err)
		}
	}
}

func TestCommitTourCommandStartsDetachedWorker(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	olderHash := commitTourTestHash(t, repo)
	attachCommitTourTestNote(t, repo, olderHash)
	commit := exec.Command("git", "-C", repo, "commit", "--allow-empty", "-m", "New untoured HEAD")
	if output, err := commit.CombinedOutput(); err != nil {
		t.Fatalf("commit new HEAD: %v: %s", err, output)
	}
	hash := commitTourTestHash(t, repo)
	model := "predictable"
	conversation, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	server.commitTourRun = func(ctx context.Context, childID string, target commitTourTarget, prompt, modelID, reasoning string) error {
		if target.Hash != hash || target.Worktree != repo || childID == "" || modelID != model {
			return fmt.Errorf("unexpected worker input: %#v %q %q", target, childID, modelID)
		}
		for _, want := range []string{"<commit_tour_skill>", hash, repo, "attach"} {
			if !strings.Contains(prompt, want) {
				return fmt.Errorf("prompt missing %q", want)
			}
		}
		close(started)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour")
	req := httptest.NewRequest(http.MethodPost, "/api/conversation/"+conversation.ConversationID+"/chat", strings.NewReader(body))
	w := httptest.NewRecorder()
	server.handleChatConversation(w, req, conversation.ConversationID)
	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var accepted struct {
		Tour CommitTourStatus `json:"tour"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	if accepted.Tour.Status != commitTourStatusBuilding || accepted.Tour.Hash != hash || accepted.Tour.WorkerSlug == "" {
		t.Fatalf("tour response = %#v", accepted.Tour)
	}
	<-started

	children, err := database.GetSubagents(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(children) != 1 {
		t.Fatalf("children = %#v", children)
	}
	opts := db.ParseConversationOptions(children[0].ConversationOptions)
	if opts.Kind != commitTourKind || opts.CommitTour == nil || opts.CommitTour.Commit != hash || opts.CommitTour.State != string(commitTourStatusBuilding) {
		t.Fatalf("child options = %#v", opts)
	}
	parentMessages, err := database.ListMessages(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(parentMessages) != 1 || parentMessages[0].Type != string(db.MessageTypeGitInfo) || parentMessages[0].UserData == nil {
		t.Fatalf("tour command did not record a status message: %#v", parentMessages)
	}
	var marker struct {
		TourRequest bool   `json:"tour_request"`
		Commit      string `json:"commit"`
		Worktree    string `json:"worktree"`
	}
	if err := json.Unmarshal([]byte(*parentMessages[0].UserData), &marker); err != nil {
		t.Fatal(err)
	}
	if !marker.TourRequest || marker.Commit != hash || marker.Worktree != repo {
		t.Fatalf("tour marker = %#v", marker)
	}

	done := commitTourJobDone(t, server, accepted.Tour.Repository, hash)
	close(release)
	<-done
	status, err := server.commitTourStatus(t.Context(), commitTourTarget{Repository: accepted.Tour.Repository, Worktree: repo, Hash: hash})
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != commitTourStatusFailed {
		t.Fatalf("status after worker without note = %#v", status)
	}
}

func TestCommitTourRequestMessageIsOnlyRecordedForNewWorker(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	model := "predictable"
	conversation, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	server.commitTourRun = func(ctx context.Context, _ string, _ commitTourTarget, _, _, _ string) error {
		close(started)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	request := func() CommitTourStatus {
		body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour")
		w := httptest.NewRecorder()
		server.handleChatConversation(w, httptest.NewRequest(http.MethodPost, "/api/conversation/"+conversation.ConversationID+"/chat", strings.NewReader(body)), conversation.ConversationID)
		if w.Code != http.StatusAccepted && w.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", w.Code, w.Body.String())
		}
		var accepted struct {
			Tour CommitTourStatus `json:"tour"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil {
			t.Fatal(err)
		}
		return accepted.Tour
	}

	first := request()
	<-started
	second := request()
	if first.Hash != hash || second.WorkerConversationID != first.WorkerConversationID {
		t.Fatalf("requests = %#v, %#v", first, second)
	}
	messages, err := database.ListMessages(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("request markers = %#v", messages)
	}
	done := commitTourJobDone(t, server, first.Repository, hash)
	close(release)
	<-done

	attachCommitTourTestNote(t, repo, hash)
	third := request()
	if third.Status != commitTourStatusPresent || third.Hash != hash {
		t.Fatalf("verified HEAD request = %#v", third)
	}
	messages, err = database.ListMessages(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("verified HEAD request added markers: %#v", messages)
	}
}

func TestCommitTourRequestSkipsMarkerUnderGitInfoForSameCommit(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	model := "predictable"
	conversation, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateMessage(t.Context(), db.CreateMessageParams{
		ConversationID: conversation.ConversationID,
		Type:           db.MessageTypeGitInfo,
		UserData:       GitInfoUserData{Worktree: repo, Commit: hash},
	}); err != nil {
		t.Fatal(err)
	}

	release := make(chan struct{})
	server.commitTourRun = func(ctx context.Context, _ string, _ commitTourTarget, _, _, _ string) error {
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour")
	w := httptest.NewRecorder()
	server.handleChatConversation(w, httptest.NewRequest(http.MethodPost, "/api/conversation/"+conversation.ConversationID+"/chat", strings.NewReader(body)), conversation.ConversationID)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var accepted struct {
		Tour CommitTourStatus `json:"tour"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	if accepted.Tour.Status != commitTourStatusBuilding || accepted.Tour.Hash != hash {
		t.Fatalf("tour response = %#v", accepted.Tour)
	}
	messages, err := database.ListMessages(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 1 {
		t.Fatalf("tour under gitinfo for the same commit added a marker: %#v", messages)
	}
	done := commitTourJobDone(t, server, accepted.Tour.Repository, hash)
	close(release)
	<-done
}

func TestCommitTourRequestMessageRejectsUnbornHEAD(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := t.TempDir()
	if err := exec.Command("git", "init", repo).Run(); err != nil {
		t.Fatal(err)
	}
	model := "predictable"
	conversation, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}

	body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour")
	w := httptest.NewRecorder()
	server.handleChatConversation(w, httptest.NewRequest(http.MethodPost, "/api/conversation/"+conversation.ConversationID+"/chat", strings.NewReader(body)), conversation.ConversationID)
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "no commit at HEAD") {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	children, err := database.GetSubagents(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(children) != 0 {
		t.Fatalf("workers = %#v", children)
	}
	messages, err := database.ListMessages(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 0 {
		t.Fatalf("markers = %#v", messages)
	}
}

func TestCommitTourWorkerStaysBuildingDuringShutdown(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	server.commitTourRun = func(context.Context, string, commitTourTarget, string, string, string) error {
		close(started)
		<-server.shutdownCh
		return errors.New("server shutting down")
	}

	body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour "+hash)
	req := httptest.NewRequest(http.MethodPost, "/api/conversation/"+parent.ConversationID+"/chat", strings.NewReader(body))
	w := httptest.NewRecorder()
	server.handleChatConversation(w, req, parent.ConversationID)
	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var accepted struct {
		Tour CommitTourStatus `json:"tour"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	<-started
	done := commitTourJobDone(t, server, accepted.Tour.Repository, hash)
	close(server.shutdownCh)
	<-done

	child, err := database.GetConversationByID(t.Context(), accepted.Tour.WorkerConversationID)
	if err != nil {
		t.Fatal(err)
	}
	request, ok := commitTourRequestFromConversation(*child)
	if !ok || request.State != commitTourStatusBuilding {
		t.Fatalf("shutdown worker state = %#v", request)
	}
	server.commitTourMu.Lock()
	job := server.commitTourJobs[commitTourKey(commitTourTarget{Repository: accepted.Tour.Repository, Hash: hash})]
	server.commitTourMu.Unlock()
	if job != nil {
		t.Fatal("shutdown worker remained registered")
	}
}

func TestCommitTourCommandIsSingleFlight(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	model := "predictable"
	conversation, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	server.commitTourRun = func(ctx context.Context, _ string, _ commitTourTarget, _, _, _ string) error {
		close(started)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	request := func(ref string) CommitTourStatus {
		body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour "+ref)
		req := httptest.NewRequest(http.MethodPost, "/api/conversation/"+conversation.ConversationID+"/chat", strings.NewReader(body))
		w := httptest.NewRecorder()
		server.handleChatConversation(w, req, conversation.ConversationID)
		if w.Code != http.StatusAccepted && w.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", w.Code, w.Body.String())
		}
		var accepted struct {
			Tour CommitTourStatus `json:"tour"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil {
			t.Fatal(err)
		}
		return accepted.Tour
	}

	first := request(hash[:7])
	<-started
	second := request(hash)
	if first.WorkerConversationID == "" || second.WorkerConversationID != first.WorkerConversationID {
		t.Fatalf("workers differ: first=%#v second=%#v", first, second)
	}
	children, err := database.GetSubagents(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(children) != 1 {
		t.Fatalf("children = %#v", children)
	}
	done := commitTourJobDone(t, server, first.Repository, hash)
	close(release)
	<-done
}

func TestRecoverCommitTourWorker(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	target, err := resolveCommitTourTarget(repo, hash)
	if err != nil {
		t.Fatal(err)
	}
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateCommitTourWorker(t.Context(), parent.ConversationID, repo, model, db.ConversationOptions{
		Kind:                 commitTourKind,
		DisableNotifications: true,
		CommitTour: &db.CommitTourRequest{
			Repository:  target.Repository,
			Worktree:    target.Worktree,
			Commit:      target.Hash,
			State:       commitTourStatusBuilding,
			RequestedAt: time.Now().UTC(),
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	server.commitTourRun = func(ctx context.Context, childID string, _ commitTourTarget, _, _, _ string) error {
		if childID != child.ConversationID {
			return fmt.Errorf("child = %q, want %q", childID, child.ConversationID)
		}
		attachCommitTourTestNote(t, repo, hash)
		close(started)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	server.recoverCommitTourWorkers(t.Context())
	<-started
	done := commitTourJobDone(t, server, target.Repository, target.Hash)
	close(release)
	<-done
	status, err := server.commitTourStatus(t.Context(), target)
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != commitTourStatusPresent {
		t.Fatalf("status = %#v", status)
	}
}

func TestRecoverCommitTourWorkerDoesNotFailActiveJob(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	target, err := resolveCommitTourTarget(repo, hash)
	if err != nil {
		t.Fatal(err)
	}
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateCommitTourWorker(t.Context(), parent.ConversationID, repo, model, db.ConversationOptions{
		Kind: commitTourKind,
		CommitTour: &db.CommitTourRequest{
			Repository:  target.Repository,
			Worktree:    target.Worktree,
			Commit:      target.Hash,
			State:       commitTourStatusBuilding,
			RequestedAt: time.Now().UTC(),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateMessage(t.Context(), db.CreateMessageParams{
		ConversationID: child.ConversationID,
		Type:           db.MessageTypeAgent,
		LLMData: llm.Message{
			Role:      llm.MessageRoleAssistant,
			Content:   llm.TextContent("tour attached"),
			EndOfTurn: true,
		},
	}); err != nil {
		t.Fatal(err)
	}

	job := &commitTourJob{
		key:      commitTourKey(target),
		parentID: parent.ConversationID,
		childID:  child.ConversationID,
		target:   target,
		status:   commitTourStatusBuilding,
		cancel:   func() {},
		done:     make(chan struct{}),
	}
	server.commitTourMu.Lock()
	server.commitTourJobs[job.key] = job
	server.commitTourMu.Unlock()
	t.Cleanup(func() {
		server.commitTourMu.Lock()
		delete(server.commitTourJobs, job.key)
		server.commitTourMu.Unlock()
	})

	server.recoverCommitTourWorkers(t.Context())
	updated, err := database.GetConversationByID(t.Context(), child.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	request, ok := commitTourRequestFromConversation(*updated)
	if !ok || request.State != commitTourStatusBuilding {
		t.Fatalf("active worker state = %#v", request)
	}
}

func TestRecoverCommitTourWorkerDoesNotFailActiveJobWithMissingWorktree(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	target, err := resolveCommitTourTarget(repo, hash)
	if err != nil {
		t.Fatal(err)
	}
	target.Worktree = filepath.Join(t.TempDir(), "missing")
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateCommitTourWorker(t.Context(), parent.ConversationID, repo, model, db.ConversationOptions{
		Kind: commitTourKind,
		CommitTour: &db.CommitTourRequest{
			Repository:  target.Repository,
			Worktree:    target.Worktree,
			Commit:      target.Hash,
			State:       commitTourStatusBuilding,
			RequestedAt: time.Now().UTC(),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	job := &commitTourJob{
		key:      commitTourKey(target),
		parentID: parent.ConversationID,
		childID:  child.ConversationID,
		target:   target,
		status:   commitTourStatusBuilding,
		cancel:   func() {},
		done:     make(chan struct{}),
	}
	server.commitTourMu.Lock()
	server.commitTourJobs[job.key] = job
	server.commitTourMu.Unlock()
	t.Cleanup(func() {
		server.commitTourMu.Lock()
		delete(server.commitTourJobs, job.key)
		server.commitTourMu.Unlock()
	})

	server.recoverCommitTourWorkers(t.Context())
	updated, err := database.GetConversationByID(t.Context(), child.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	request, ok := commitTourRequestFromConversation(*updated)
	if !ok || request.State != commitTourStatusBuilding {
		t.Fatalf("active worker state = %#v", request)
	}
}

func TestRecoverCommitTourWorkerRejectsReplacedWorktree(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	worktree := filepath.Join(t.TempDir(), "linked")
	if out, err := exec.Command("git", "-C", repo, "worktree", "add", "--detach", worktree, hash).CombinedOutput(); err != nil {
		t.Fatalf("git worktree add: %v: %s", err, out)
	}
	target, err := resolveCommitTourTarget(worktree, hash)
	if err != nil {
		t.Fatal(err)
	}
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &worktree, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateCommitTourWorker(t.Context(), parent.ConversationID, worktree, model, db.ConversationOptions{
		Kind: commitTourKind,
		CommitTour: &db.CommitTourRequest{
			Repository:  target.Repository,
			Worktree:    target.Worktree,
			Commit:      target.Hash,
			State:       commitTourStatusBuilding,
			RequestedAt: time.Now().UTC(),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "-C", repo, "worktree", "remove", "--force", worktree).CombinedOutput(); err != nil {
		t.Fatalf("git worktree remove: %v: %s", err, out)
	}
	if out, err := exec.Command("git", "clone", "--quiet", repo, worktree).CombinedOutput(); err != nil {
		t.Fatalf("git clone: %v: %s", err, out)
	}
	release := make(chan struct{})
	defer close(release)
	server.commitTourRun = func(context.Context, string, commitTourTarget, string, string, string) error {
		<-release
		return nil
	}

	server.recoverCommitTourWorkers(t.Context())
	server.commitTourMu.Lock()
	job := server.commitTourJobs[commitTourKey(target)]
	server.commitTourMu.Unlock()
	if job != nil {
		t.Fatal("recovery resumed a worker in a replaced repository")
	}
	updated, err := database.GetConversationByID(t.Context(), child.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	request, ok := commitTourRequestFromConversation(*updated)
	if !ok || request.State != commitTourStatusFailed || !strings.Contains(request.Error, "requested repository") {
		t.Fatalf("replaced worktree state = %#v", request)
	}
}

func TestRecoverCommitTourWorkersDoesNotStartDuringShutdown(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	target, err := resolveCommitTourTarget(repo, hash)
	if err != nil {
		t.Fatal(err)
	}
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateCommitTourWorker(t.Context(), parent.ConversationID, repo, model, db.ConversationOptions{
		Kind: commitTourKind,
		CommitTour: &db.CommitTourRequest{
			Repository:  target.Repository,
			Worktree:    target.Worktree,
			Commit:      target.Hash,
			State:       commitTourStatusBuilding,
			RequestedAt: time.Now().UTC(),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	close(server.shutdownCh)
	server.recoverCommitTourWorkers(t.Context())

	server.commitTourMu.Lock()
	job := server.commitTourJobs[commitTourKey(target)]
	server.commitTourMu.Unlock()
	if job != nil {
		t.Fatal("recovery started a worker during shutdown")
	}
	updated, err := database.GetConversationByID(t.Context(), child.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	request, ok := commitTourRequestFromConversation(*updated)
	if !ok || request.State != commitTourStatusBuilding {
		t.Fatalf("shutdown recovery state = %#v", request)
	}
}

func TestRecoverCommitTourWorkersIsGloballyBounded(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if i > 0 {
			path := filepath.Join(repo, fmt.Sprintf("extra-%d.txt", i))
			if err := os.WriteFile(path, []byte(fmt.Sprintf("%d\n", i)), 0o644); err != nil {
				t.Fatal(err)
			}
			if out, err := exec.Command("git", "-C", repo, "add", filepath.Base(path)).CombinedOutput(); err != nil {
				t.Fatalf("git add: %v: %s", err, out)
			}
			if out, err := exec.Command("git", "-C", repo, "commit", "-m", fmt.Sprintf("Commit %d", i), "-m", "Prompt: recovery bound test").CombinedOutput(); err != nil {
				t.Fatalf("git commit: %v: %s", err, out)
			}
		}
		target, err := resolveCommitTourTarget(repo, commitTourTestHash(t, repo))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := database.CreateCommitTourWorker(t.Context(), parent.ConversationID, repo, model, db.ConversationOptions{
			Kind: commitTourKind,
			CommitTour: &db.CommitTourRequest{
				Repository:  target.Repository,
				Worktree:    target.Worktree,
				Commit:      target.Hash,
				State:       commitTourStatusBuilding,
				RequestedAt: time.Now().UTC(),
			},
		}); err != nil {
			t.Fatal(err)
		}
	}

	started := make(chan string, 3)
	release := make(chan struct{})
	server.commitTourRun = func(ctx context.Context, childID string, _ commitTourTarget, _, _, _ string) error {
		started <- childID
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	server.recoverCommitTourWorkers(t.Context())
	firstStarted := <-started
	secondStarted := <-started
	server.commitTourMu.Lock()
	if len(server.commitTourJobs) != 2 {
		server.commitTourMu.Unlock()
		t.Fatalf("recovered jobs = %d, want 2", len(server.commitTourJobs))
	}
	var done []<-chan struct{}
	for _, job := range server.commitTourJobs {
		done = append(done, job.done)
	}
	server.commitTourMu.Unlock()
	if len(server.commitTourRecoverySlots) != 2 {
		t.Fatalf("recovery slots = %d, want 2", len(server.commitTourRecoverySlots))
	}
	close(release)
	for _, ch := range done {
		<-ch
	}
	thirdStarted := <-started
	if thirdStarted == firstStarted || thirdStarted == secondStarted {
		t.Fatalf("recovery restarted an existing worker: %q", thirdStarted)
	}
}

func TestRecoverCommitTourWorkerResumesWithoutReprompting(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	target, err := resolveCommitTourTarget(repo, hash)
	if err != nil {
		t.Fatal(err)
	}
	model := "predictable"
	parent, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateCommitTourWorker(t.Context(), parent.ConversationID, repo, model, db.ConversationOptions{
		Kind: commitTourKind,
		CommitTour: &db.CommitTourRequest{
			Repository:  target.Repository,
			Worktree:    target.Worktree,
			Commit:      target.Hash,
			State:       commitTourStatusBuilding,
			RequestedAt: time.Now().UTC(),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.CreateMessage(t.Context(), db.CreateMessageParams{
		ConversationID: child.ConversationID,
		Type:           db.MessageTypeUser,
		LLMData:        llm.UserStringMessage(commitTourPrompt(target, "skill")),
	}); err != nil {
		t.Fatal(err)
	}
	if err := database.SetConversationAgentWorking(t.Context(), child.ConversationID, true); err != nil {
		t.Fatal(err)
	}

	server.recoverCommitTourWorkers(t.Context())
	done := commitTourJobDone(t, server, target.Repository, target.Hash)
	<-done
	messages, err := database.ListMessages(t.Context(), child.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	userCount := 0
	for _, message := range messages {
		if message.Type == string(db.MessageTypeUser) {
			userCount++
		}
	}
	if userCount != 1 {
		t.Fatalf("resume added another child prompt: got %d user rows", userCount)
	}
}

func TestCommitTourSubagentDoesNotNotifyParent(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	model := "predictable"
	conversation, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}

	body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour "+hash)
	req := httptest.NewRequest(http.MethodPost, "/api/conversation/"+conversation.ConversationID+"/chat", strings.NewReader(body))
	w := httptest.NewRecorder()
	server.handleChatConversation(w, req, conversation.ConversationID)
	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var accepted struct {
		Tour CommitTourStatus `json:"tour"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	before, err := database.ListMessages(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	done := commitTourJobDone(t, server, accepted.Tour.Repository, hash)
	<-done
	messages, err := database.ListMessages(t.Context(), conversation.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != len(before) {
		t.Fatalf("tour subagent changed parent history: %#v", messages)
	}
}

func TestDeletingCommitTourParentCancelsWorker(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	model := "predictable"
	conversation, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	server.commitTourRun = func(ctx context.Context, _ string, _ commitTourTarget, _, _, _ string) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	}
	body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour "+hash)
	req := httptest.NewRequest(http.MethodPost, "/api/conversation/"+conversation.ConversationID+"/chat", strings.NewReader(body))
	w := httptest.NewRecorder()
	server.handleChatConversation(w, req, conversation.ConversationID)
	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var accepted struct {
		Tour CommitTourStatus `json:"tour"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	<-started
	done := commitTourJobDone(t, server, accepted.Tour.Repository, hash)
	if err := server.deleteConversation(t.Context(), conversation.ConversationID); err != nil {
		t.Fatal(err)
	}
	<-done
	server.commitTourMu.Lock()
	job := server.commitTourJobs[accepted.Tour.Repository+"\x00"+hash]
	server.commitTourMu.Unlock()
	if job != nil {
		t.Fatal("deleted commit tour worker remained registered")
	}
}

func TestCommitTourWorkerPublishesVerifiedTour(t *testing.T) {
	server, database, _ := newTestServer(t)
	defer stopActiveConversationLoops(server)
	repo := setupTestGitRepo(t)
	hash := commitTourTestHash(t, repo)
	model := "predictable"
	conversation, err := database.CreateConversation(t.Context(), nil, true, &repo, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	release := make(chan struct{})
	server.commitTourRun = func(ctx context.Context, _ string, _ commitTourTarget, _, _, _ string) error {
		attachCommitTourTestNote(t, repo, hash)
		close(started)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	body := fmt.Sprintf(`{"message":%q,"model":"predictable"}`, "/tour "+hash)
	req := httptest.NewRequest(http.MethodPost, "/api/conversation/"+conversation.ConversationID+"/chat", strings.NewReader(body))
	w := httptest.NewRecorder()
	server.handleChatConversation(w, req, conversation.ConversationID)
	if w.Code != http.StatusAccepted {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var accepted struct {
		Tour CommitTourStatus `json:"tour"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	<-started
	done := commitTourJobDone(t, server, accepted.Tour.Repository, hash)
	close(release)
	<-done

	status, err := server.commitTourStatus(t.Context(), commitTourTarget{Repository: accepted.Tour.Repository, Worktree: repo, Hash: hash})
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != commitTourStatusPresent {
		t.Fatalf("status = %#v", status)
	}
}
