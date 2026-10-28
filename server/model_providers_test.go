package server

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"shelley.exe.dev/modelproviders"
)

func TestModelProviderHandlersWithoutManager(t *testing.T) {
	s := &Server{}
	list := httptest.NewRecorder()
	s.handleListModelProviders(list, httptest.NewRequest(http.MethodGet, "/api/model-providers", nil))
	if list.Code != http.StatusOK || strings.TrimSpace(list.Body.String()) != "[]" {
		t.Fatalf("disabled list: %d %s", list.Code, list.Body.String())
	}
	for _, handler := range []func(http.ResponseWriter, *http.Request){
		s.handleCheckModelProvider, s.handleCreateModelProvider, s.handleUpdateModelProvider, s.handleRefreshModelProvider, s.handleDeleteModelProvider,
	} {
		rec := httptest.NewRecorder()
		handler(rec, httptest.NewRequest(http.MethodPost, "/api/model-providers/id", nil))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("disabled mutation: %d %s", rec.Code, rec.Body.String())
		}
	}
}

func TestModelProviderInputAndErrorResponses(t *testing.T) {
	var logs bytes.Buffer
	s := &Server{logger: slog.New(slog.NewTextHandler(&logs, nil))}
	for _, body := range []string{`{`, `{"endpoint":"https://example","unknown":true}`, `{} {}`} {
		rec := httptest.NewRecorder()
		if _, err := decodeModelProviderInput(rec, httptest.NewRequest(http.MethodPost, "/api/model-providers", strings.NewReader(body))); err == nil {
			t.Fatalf("accepted invalid body %q", body)
		}
	}
	for _, tc := range []struct {
		err  error
		want int
	}{
		{modelproviders.ErrInvalid, http.StatusBadRequest},
		{modelproviders.ErrNotFound, http.StatusNotFound},
		{modelproviders.ErrConflict, http.StatusConflict},
		{modelproviders.ErrDuplicate, http.StatusConflict},
		{modelproviders.ErrDiscovery, http.StatusBadGateway},
		{errors.New("secret from database"), http.StatusInternalServerError},
	} {
		rec := httptest.NewRecorder()
		s.writeModelProviderError(rec, tc.err)
		if rec.Code != tc.want || bytes.Contains(rec.Body.Bytes(), []byte("secret")) {
			t.Fatalf("error %v: %d %s", tc.err, rec.Code, rec.Body.String())
		}
		if !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") || strings.TrimSpace(rec.Body.String()) == "" {
			t.Fatalf("error was not plain text: %s", rec.Body.String())
		}
		if tc.want == http.StatusInternalServerError && !strings.Contains(logs.String(), "secret from database") {
			t.Fatal("internal error was not logged")
		}
	}
}
