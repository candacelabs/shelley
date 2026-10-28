package server

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// TestDebugIndex checks that /debug redirects to the index and that every
// page the index links to is served. Requiring a <title> rejects the
// FileServer's directory listing, served for a directory without index.html.
func TestDebugIndex(t *testing.T) {
	t.Parallel()
	server, _, _ := newTestServer(t)
	mux := http.NewServeMux()
	server.RegisterRoutes(mux)
	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}

	for path, want := range map[string]string{"/debug": "/debug/", "/debug/conversations": "conversations/"} {
		if w := get(path); w.Code/100 != 3 || w.Header().Get("Location") != want {
			t.Errorf("GET %s = %d %q, want redirect to %q", path, w.Code, w.Header().Get("Location"), want)
		}
	}
	w := get("/debug/")
	if w.Code != http.StatusOK {
		t.Fatalf("GET /debug/ = %d: %s", w.Code, w.Body.String())
	}
	links := regexp.MustCompile(`<a href="(/debug/[^"]*)"`).FindAllStringSubmatch(w.Body.String(), -1)
	if len(links) < 9 {
		t.Fatalf("index has %d debug links, want at least 9:\n%s", len(links), w.Body.String())
	}
	for _, m := range links {
		if w := get(m[1]); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "<title>") {
			t.Errorf("GET %s (linked from /debug/) = %d, want a page with a <title>", m[1], w.Code)
		}
	}
	if w := get("/debug/nope"); w.Code != http.StatusNotFound {
		t.Errorf("GET /debug/nope = %d, want 404", w.Code)
	}
}
