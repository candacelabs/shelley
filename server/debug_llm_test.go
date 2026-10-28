package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"shelley.exe.dev/db"
	"shelley.exe.dev/llm/llmhttp"
)

// TestDebugLLM sends a request through an llmhttp client and checks that the
// /debug/llm page, assets, and API expose it.
func TestDebugLLM(t *testing.T) {
	t.Parallel()
	server, database, _ := newTestServer(t)
	mux := http.NewServeMux()
	server.RegisterRoutes(mux)

	slug := "debug-llm-test"
	conv, err := database.CreateConversation(t.Context(), &slug, true, nil, nil, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()
	ctx := llmhttp.WithConversationID(t.Context(), conv.ConversationID)
	req, _ := http.NewRequestWithContext(ctx, "POST", upstream.URL, strings.NewReader(`{"messages":[]}`))
	resp, err := llmhttp.NewClient(nil).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}

	if w := get("/debug/llm/"); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "/debug/llm/llm.js") {
		t.Errorf("GET /debug/llm/ = %d: %s", w.Code, w.Body.String())
	}

	w := get("/api/debug/llm/exchanges")
	type entry struct {
		llmhttp.Exchange
		Slug string
	}
	var list []entry
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("list: %v: %s", err, w.Body.String())
	}
	i := slices.IndexFunc(list, func(e entry) bool { return e.ConversationID == conv.ConversationID })
	if i < 0 || list[i].Slug != slug || list[i].Status != 200 || !list[i].Done {
		t.Fatalf("list = %+v", list)
	}

	path := fmt.Sprintf("/api/debug/llm/exchanges/%d", list[i].ID)
	w = get(path)
	var d llmhttp.Exchange
	if err := json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatalf("detail: %v: %s", err, w.Body.String())
	}
	if d.RequestBody != `{"messages":[]}` || d.ResponseBody != `{"ok":true}` || w.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("detail = %s (Cache-Control %q)", w.Body.String(), w.Header().Get("Cache-Control"))
	}

	if w := get("/api/debug/llm/exchanges/0"); w.Code != http.StatusNotFound {
		t.Errorf("missing exchange status = %d", w.Code)
	}

	// The data holds prompts, so it must sit behind the same header check as /api/.
	protected := RequireHeaderMiddleware("X-Exedev-Userid")(mux)
	w = httptest.NewRecorder()
	protected.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
	if w.Code != http.StatusForbidden {
		t.Errorf("without required header: status = %d", w.Code)
	}
}
