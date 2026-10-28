package server

import (
	"cmp"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"shelley.exe.dev/db"
)

func writeStatusBarHook(t *testing.T, dir, script string) {
	t.Helper()
	writeShellScript(t, filepath.Join(dir, hookStatusBar), script)
}

func TestStatusBarHookOutput(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, script string
		want         StatusBar
		wantErr      string
	}{
		{"status", `echo '{"body":" main ","bgcolor":"#204a87","color":"white"}'`, StatusBar{Body: "main", BGColor: "#204a87", Color: "white"}, ""},
		{"silent", `true`, StatusBar{}, ""},
		{"failure", `echo '{"body":"x"}'; echo 'not a repo' >&2; exit 3`, StatusBar{}, "exit status 3: not a repo"},
		{"not JSON", `echo main`, StatusBar{}, "invalid JSON output: invalid character 'm' looking for beginning of value"},
		{"unknown field", `echo '{"text":"main"}'`, StatusBar{}, `invalid JSON output: json: unknown field "text"`},
		{"two values", `echo '{}{}'`, StatusBar{}, "invalid JSON output: trailing data after the object"},
		{"trailing bracket", `echo '{"body":"x"}]'`, StatusBar{}, "invalid JSON output: trailing data after the object"},
		{"too long", `head -c 5000 /dev/zero | tr '\0' x`, StatusBar{}, "output exceeds 4096 bytes"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			writeStatusBarHook(t, dir, tc.script)
			got, err := runStatusBarHookIn(t.Context(), dir, StatusBarHookInput{Cwd: t.TempDir()})
			if got != tc.want || fmt.Sprint(err) != cmp.Or(tc.wantErr, "<nil>") {
				t.Fatalf("got %+v, %v; want %+v, %s", got, err, tc.want, tc.wantErr)
			}
		})
	}

	dir := t.TempDir()
	if got, err := runStatusBarHookIn(t.Context(), dir, StatusBarHookInput{Cwd: t.TempDir()}); got != (StatusBar{}) || err != nil {
		t.Fatalf("missing hook: %+v, %v", got, err)
	}
	if err := os.WriteFile(filepath.Join(dir, hookStatusBar), []byte("#!/bin/sh\necho '{\"body\":\"hi\"}'\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, err := runStatusBarHookIn(t.Context(), dir, StatusBarHookInput{Cwd: t.TempDir()}); got != (StatusBar{}) || err != nil {
		t.Fatalf("non-executable hook: %+v, %v", got, err)
	}
}

// The hook runs in the conversation's directory with its context on stdin.
func TestStatusBarHookInput(t *testing.T) {
	t.Parallel()
	hooks, cwd := t.TempDir(), t.TempDir()
	writeStatusBarHook(t, hooks, `cat > input.json; echo "$GIT_OPTIONAL_LOCKS" > locks; echo '{"body":"ok"}'`)
	input := StatusBarHookInput{ConversationID: "cABC", Slug: "fix-it", Cwd: cwd, Model: "predictable"}
	if got, err := runStatusBarHookIn(t.Context(), hooks, input); got != (StatusBar{Body: "ok"}) || err != nil {
		t.Fatalf("got %+v, %v", got, err)
	}
	for _, missing := range []string{"", filepath.Join(cwd, "gone"), filepath.Join(hooks, hookStatusBar)} {
		if got, err := runStatusBarHookIn(t.Context(), hooks, StatusBarHookInput{Cwd: missing}); got != (StatusBar{}) || err != nil {
			t.Fatalf("cwd %q: got %+v, %v", missing, got, err)
		}
	}
	data, err := os.ReadFile(filepath.Join(cwd, "input.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got StatusBarHookInput
	if err := json.Unmarshal(data, &got); err != nil || got != input {
		t.Fatalf("stdin %s: %+v, %v", data, got, err)
	}
	// So a "git status" here can't make the agent's "git add" fail.
	if locks, err := os.ReadFile(filepath.Join(cwd, "locks")); string(locks) != "0\n" {
		t.Fatalf("GIT_OPTIONAL_LOCKS = %q, %v", locks, err)
	}
}

func TestStatusBarEndpoint(t *testing.T) {
	t.Parallel()
	s, database, _ := newTestServer(t)
	cwd := t.TempDir()
	slug, model := "status-demo", "predictable"
	conv, err := database.CreateConversation(t.Context(), &slug, true, &cwd, &model, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	get := func(id string, wantCode int, want StatusBar) {
		t.Helper()
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/conversation/"+id+"/status-bar", nil))
		if rec.Code != wantCode {
			t.Fatalf("status %d, want %d: %s", rec.Code, wantCode, rec.Body)
		}
		if wantCode != http.StatusOK {
			return
		}
		var got StatusBar
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got != want {
			t.Fatalf("got %+v (%v), want %+v", got, err, want)
		}
	}

	get(conv.ConversationID, http.StatusOK, StatusBar{})
	writeStatusBarHook(t, s.hooksDir, `printf '{"body":"%s in %s","bgcolor":"red"}' "$(sed 's/.*"slug":"\([^"]*\)".*/\1/')" "$(basename "$PWD")"`)
	get(conv.ConversationID, http.StatusOK, StatusBar{Body: slug + " in " + filepath.Base(cwd), BGColor: "red"})
	writeStatusBarHook(t, s.hooksDir, `exit 1`)
	get(conv.ConversationID, http.StatusOK, StatusBar{Error: "status-bar hook failed: exit status 1"})
	get("cNOPE", http.StatusNotFound, StatusBar{})
}
