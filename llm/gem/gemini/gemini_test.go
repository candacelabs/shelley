package gemini

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestGenerateContentKeepsAPIKeyOutOfURL(t *testing.T) {
	const apiKey = "secret-api-key"
	var gotReq *http.Request
	m := Model{
		Model:  "models/gemini-test",
		APIKey: apiKey,
		HTTPC: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			gotReq = req
			return nil, errors.New("transport failed")
		})},
	}

	_, err := m.GenerateContent(t.Context(), &Request{})
	if err == nil {
		t.Fatal("GenerateContent succeeded, want transport error")
	}
	if gotReq == nil {
		t.Fatal("transport did not receive a request")
	}
	if got := gotReq.Header.Get("x-goog-api-key"); got != apiKey {
		t.Errorf("x-goog-api-key = %q, want API key", got)
	}
	if strings.Contains(gotReq.URL.String(), apiKey) {
		t.Errorf("request URL contains API key: %s", gotReq.URL)
	}
	if strings.Contains(err.Error(), apiKey) {
		t.Errorf("transport error contains API key: %v", err)
	}
}

func TestGenerateContent(t *testing.T) {
	// TODO replace with local replay endpoint
	m := Model{
		Model:  "models/gemini-3.6-flash",
		APIKey: os.Getenv("GEMINI_API_KEY"),
	}
	if testing.Short() {
		t.Skip("skipping test in short mode")
	}
	if m.APIKey == "" {
		t.Skip("skipping test without API key")
	}

	res, err := m.GenerateContent(t.Context(), &Request{
		Contents: []Content{{
			Parts: []Part{{
				Text: "What is the capital of France?",
			}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("res: %+v", res)
}
