package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"shelley.exe.dev/db/generated"
)

const (
	statusBarHookTimeout   = 2 * time.Second
	statusBarHookMaxOutput = 4 << 10
	statusBarHookGrace     = 500 * time.Millisecond
)

// StatusBarHookInput is the JSON the status-bar hook reads on stdin. The hook
// runs in the conversation's working directory, and not at all without one.
type StatusBarHookInput struct {
	ConversationID string `json:"conversation_id"`
	Slug           string `json:"slug"`
	Cwd            string `json:"cwd"`
	Model          string `json:"model"`
}

// StatusBar is what the status-bar hook printed for a conversation, or why
// it failed. All empty means show nothing.
type StatusBar struct {
	Body    string `json:"body,omitempty"`
	BGColor string `json:"bgcolor,omitempty"`
	Color   string `json:"color,omitempty"`
	Error   string `json:"error,omitempty"`
}

// cappedBuffer keeps the first max bytes and notes whether more arrived. It
// never fails a write, so a chatty hook is not left blocked on a full pipe.
// It must not embed bytes.Buffer: io.Copy would use its ReadFrom, uncapped.
type cappedBuffer struct {
	buf  bytes.Buffer
	max  int
	over bool
}

func (b *cappedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	if room := b.max - b.buf.Len(); n > room {
		b.over = true
		p = p[:room]
	}
	b.buf.Write(p)
	return n, nil
}

// runStatusBarHookIn runs the status-bar hook from hooksDir. Without one,
// the status bar is empty.
func runStatusBarHookIn(ctx context.Context, hooksDir string, input StatusBarHookInput) (StatusBar, error) {
	hookPath, err := findHookIn(hooksDir, hookStatusBar)
	if err != nil || hookPath == "" {
		return StatusBar{}, err
	}
	// A conversation whose directory is gone (a removed worktree, say) has
	// nothing to report, and saying it failed on every such one is noise.
	if st, err := os.Stat(input.Cwd); err != nil || !st.IsDir() {
		return StatusBar{}, nil
	}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return StatusBar{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, statusBarHookTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, hookPath)
	cmd.Dir = input.Cwd
	// The hook runs while the agent's tools do, often right as one starts:
	// a "git status" taking index.lock would make the agent's "git add" fail.
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	cmd.Stdin = bytes.NewReader(inputJSON)
	stdout := &cappedBuffer{max: statusBarHookMaxOutput}
	stderr := &cappedBuffer{max: statusBarHookMaxOutput}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	// Children run in the hook's process group, and any failure stops them
	// all (see stopProcessGroup), or a hook that hangs or fails every time
	// leaks a process per run.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM) }
	// Don't wait out the timeout on a background child holding stdout, nor
	// long on a hook ignoring SIGTERM.
	cmd.WaitDelay = time.Second
	err = cmd.Run()
	var status StatusBar
	if err == nil {
		status, err = parseStatusBar(stdout)
	}
	if err != nil {
		if cmd.Process != nil {
			stopProcessGroup(cmd.Process.Pid)
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			err = fmt.Errorf("timed out after %v", statusBarHookTimeout)
		} else if errors.Is(err, exec.ErrWaitDelay) {
			err = errors.New("a background process kept its output open")
		}
		if msg := strings.TrimSpace(stderr.buf.String()); msg != "" {
			err = fmt.Errorf("%w: %s", err, msg)
		}
		return StatusBar{}, err
	}
	return status, nil
}

// stopProcessGroup asks a failed hook's process group to stop, gives it a
// moment, so a git among them can remove its lock files, and kills what is
// left. The hook itself may be gone already; its children needn't be.
func stopProcessGroup(pgid int) {
	syscall.Kill(-pgid, syscall.SIGTERM)
	deadline := time.Now().Add(statusBarHookGrace)
	for syscall.Kill(-pgid, 0) == nil && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	syscall.Kill(-pgid, syscall.SIGKILL)
}

// parseStatusBar reads one JSON object, or nothing, from the hook's output.
func parseStatusBar(stdout *cappedBuffer) (StatusBar, error) {
	if stdout.over {
		return StatusBar{}, fmt.Errorf("output exceeds %d bytes", statusBarHookMaxOutput)
	}
	output := bytes.TrimSpace(stdout.buf.Bytes())
	if len(output) == 0 {
		return StatusBar{}, nil
	}
	var out struct {
		Body    string `json:"body"`
		BGColor string `json:"bgcolor"`
		Color   string `json:"color"`
	}
	dec := json.NewDecoder(bytes.NewReader(output))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&out); err != nil {
		return StatusBar{}, fmt.Errorf("invalid JSON output: %w", err)
	}
	if _, err := dec.Token(); err != io.EOF {
		return StatusBar{}, errors.New("invalid JSON output: trailing data after the object")
	}
	return StatusBar{Body: strings.TrimSpace(out.Body), BGColor: out.BGColor, Color: out.Color}, nil
}

// handleConversationStatusBar handles GET /api/conversation/{id}/status-bar.
// Clients ask while they show the conversation, so the hook runs only for
// conversations someone is looking at. A hook failure is reported in the
// response, so a broken hook is visible.
func (s *Server) handleConversationStatusBar(w http.ResponseWriter, r *http.Request, conversationID string) {
	ctx := r.Context()
	var conversation generated.Conversation
	err := s.db.Queries(ctx, func(q *generated.Queries) error {
		var err error
		conversation, err = q.GetConversation(ctx, conversationID)
		return err
	})
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "Conversation not found", http.StatusNotFound)
		return
	}
	if err != nil {
		s.internalError(w, "Failed to get conversation", err, "conversationID", conversationID)
		return
	}
	status, err := runStatusBarHookIn(ctx, s.hooksDir, StatusBarHookInput{
		ConversationID: conversationID,
		Slug:           derefString(conversation.Slug),
		Cwd:            derefString(conversation.Cwd),
		Model:          derefString(conversation.Model),
	})
	if err != nil {
		status = StatusBar{Error: fmt.Sprintf("%s hook failed: %v", hookStatusBar, err)}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}
