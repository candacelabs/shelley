package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestExecTerminal_CloseOnExitPolicy(t *testing.T) {
	for _, tc := range []struct {
		name  string
		query string
		want  bool
	}{
		{"close", "&close_on_exit=true", true},
		{"hold", "&close_on_exit=false", false},
		{"omitted holds", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s, _, _ := newTestServer(t)
			mux := http.NewServeMux()
			s.RegisterRoutes(mux)
			srv := httptest.NewServer(mux)
			defer srv.Close()

			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/exec-ws?"
			connect := func(query string) (*websocket.Conn, string) {
				t.Helper()
				conn, _, err := websocket.Dial(ctx, wsURL+query, nil)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { conn.CloseNow() })
				if err := wsjson.Write(ctx, conn, ExecMessage{Type: "init", Cols: 80, Rows: 24}); err != nil {
					t.Fatal(err)
				}
				var attached ExecMessage
				if err := wsjson.Read(ctx, conn, &attached); err != nil {
					t.Fatal(err)
				}
				if attached.Type != "attached" || attached.TermID == "" {
					t.Fatalf("expected attached message, got %+v", attached)
				}
				t.Cleanup(func() { _ = s.terminals.Kill(attached.TermID) })
				if attached.CloseOnExit == nil || *attached.CloseOnExit != tc.want {
					t.Errorf("attached close_on_exit = %v, want explicit %t", attached.CloseOnExit, tc.want)
				}
				return conn, attached.TermID
			}

			conn, id := connect("cmd=" + url.QueryEscape("read -r answer") + tc.query)
			if err := conn.CloseNow(); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(filepath.Join(s.terminals.dir, id+".json"))
			if err != nil {
				t.Fatal(err)
			}
			var record struct {
				CloseOnExit *bool `json:"close_on_exit"`
			}
			if err := json.Unmarshal(data, &record); err != nil {
				t.Fatal(err)
			}
			if record.CloseOnExit == nil || *record.CloseOnExit != tc.want {
				t.Errorf("persisted close_on_exit = %v, want explicit %t", record.CloseOnExit, tc.want)
			}

			s.terminals = newSessionsAt(t, s.terminals.dir)
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/terminals", nil))
			if w.Code != http.StatusOK {
				t.Fatalf("list status = %d, body = %s", w.Code, w.Body.String())
			}
			var listed []struct {
				ID          string `json:"id"`
				CloseOnExit *bool  `json:"close_on_exit"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &listed); err != nil {
				t.Fatal(err)
			}
			if len(listed) != 1 || listed[0].ID != id {
				t.Fatalf("reloaded list = %+v, want terminal %s", listed, id)
			}
			if listed[0].CloseOnExit == nil || *listed[0].CloseOnExit != tc.want {
				t.Errorf("listed close_on_exit = %v, want explicit %t", listed[0].CloseOnExit, tc.want)
			}
			// A conflicting query must not override the durable policy, nor
			// may a supplied command restart the existing session.
			conn, attachedID := connect("term_id=" + id + "&cmd=exit+99&close_on_exit=" + strconv.FormatBool(!tc.want))
			if attachedID != id {
				t.Fatalf("reattached id = %s, want %s", attachedID, id)
			}
			if err := wsjson.Write(ctx, conn, ExecMessage{Type: "input", Data: "done\n"}); err != nil {
				t.Fatal(err)
			}
			for {
				var message ExecMessage
				if err := wsjson.Read(ctx, conn, &message); err != nil {
					t.Fatal(err)
				}
				if message.Type == "exit" {
					if message.Data != "0" {
						t.Fatalf("exit = %s, want 0", message.Data)
					}
					break
				}
			}
		})
	}
}

func TestExecTerminal_InvalidCloseOnExit(t *testing.T) {
	t.Parallel()
	s, _, _ := newTestServer(t)
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	for _, value := range []string{"", "yes", "2", " true"} {
		t.Run(strconv.Quote(value), func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/exec-ws?cmd=true&close_on_exit=" + url.QueryEscape(value)
			conn, response, err := websocket.Dial(ctx, wsURL, nil)
			if conn != nil {
				conn.CloseNow()
			}
			if err == nil {
				t.Fatal("invalid close_on_exit upgraded to a websocket")
			}
			if response == nil || response.StatusCode != http.StatusBadRequest {
				t.Fatalf("expected HTTP 400 before upgrade, got %+v", response)
			}
		})
	}
	if len(s.terminals.List()) != 0 {
		t.Fatal("invalid requests spawned a terminal")
	}
}
