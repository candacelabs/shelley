package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"shelley.exe.dev/db"
)

func TestConversationSearchArchiveScope(t *testing.T) {
	t.Parallel()
	srv, database, _ := newTestServer(t)
	ids := make(map[bool]string)
	for _, archived := range []bool{false, true} {
		slug := "pelican-active"
		if archived {
			slug = "pelican-archived"
		}
		conv, err := database.CreateConversation(t.Context(), &slug, true, nil, nil, db.ConversationOptions{})
		if err != nil {
			t.Fatal(err)
		}
		ids[archived] = conv.ConversationID
		if archived {
			if _, err := database.ArchiveConversation(t.Context(), conv.ConversationID); err != nil {
				t.Fatal(err)
			}
		}
	}
	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)
	for _, tc := range []struct {
		query    string
		archived bool
	}{
		{"q=pelican&limit=1", false},
		{"q=pelican&archived=false&limit=1", false},
		{"q=pelican&archived=true&limit=1", true},
	} {
		t.Run(tc.query, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			mux.ServeHTTP(recorder, httptest.NewRequest("GET", "/api/conversations/search?"+tc.query, nil))
			if recorder.Code != http.StatusOK {
				t.Fatalf("HTTP %d: %s", recorder.Code, recorder.Body.String())
			}
			var results []ConversationWithState
			if err := json.Unmarshal(recorder.Body.Bytes(), &results); err != nil {
				t.Fatal(err)
			}
			if len(results) != 1 || results[0].ConversationID != ids[tc.archived] || results[0].Archived != tc.archived {
				t.Fatalf("unexpected archive scope: %#v", results)
			}
		})
	}
}
