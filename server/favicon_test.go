package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/rivo/uniseg"
)

func TestSafeFaviconEmojisAreSingleUniqueCodePoints(t *testing.T) {
	seen := map[string]bool{}
	for _, e := range safeFaviconEmojis {
		// Width 2 means default emoji presentation: no VS16 needed for color.
		if utf8.RuneCountInString(e) != 1 || uniseg.StringWidth(e) != 2 || !validFaviconEmoji(e) {
			t.Errorf("%q is not a single emoji-presentation code point", e)
		}
		if seen[e] {
			t.Errorf("%q is listed twice", e)
		}
		seen[e] = true
	}
}

func TestIndexPersistsRandomEmojiWithoutReflectionMetadata(t *testing.T) {
	srv, database, _ := newTestServer(t)
	srv.reflectionEmoji = func(context.Context) string { return "" }

	svg := indexFaviconSVG(t, srv)
	stored, err := database.GetSetting(t.Context(), faviconEmojiSettingKey)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(safeFaviconEmojis, stored) {
		t.Fatalf("stored favicon emoji %q is not a safe choice", stored)
	}
	if !strings.Contains(svg, ">"+stored+"</text>") {
		t.Fatalf("favicon does not use stored emoji %q: %s", stored, svg)
	}
	if again := indexFaviconSVG(t, srv); again != svg {
		t.Fatalf("favicon changed between loads: %s then %s", svg, again)
	}
}

func TestIndexReflectionEmojiDoesNotStoreEmoji(t *testing.T) {
	srv, database, _ := newTestServer(t)
	srv.reflectionEmoji = func(context.Context) string { return "🧪" }

	indexFaviconSVG(t, srv)
	stored, err := database.GetSetting(t.Context(), faviconEmojiSettingKey)
	if err != nil {
		t.Fatal(err)
	}
	if stored != "" {
		t.Fatalf("reflection emoji present, but Shelley stored %q", stored)
	}
}

func TestFaviconEmojiAPI(t *testing.T) {
	srv, _, _ := newTestServer(t)
	reflection := ""
	srv.reflectionEmoji = func(context.Context) string { return reflection }
	mux := http.NewServeMux()
	srv.RegisterRoutes(mux)
	do := func(method, body string) (int, faviconEmojiResponse) {
		t.Helper()
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(method, "/api/favicon-emoji", strings.NewReader(body)))
		var resp faviconEmojiResponse
		if w.Code == http.StatusOK {
			if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
				t.Fatal(err)
			}
		}
		return w.Code, resp
	}

	code, got := do(http.MethodGet, "")
	if code != http.StatusOK || got.Source != "shelley" || !slices.Contains(safeFaviconEmojis, got.Emoji) {
		t.Fatalf("GET = %d %+v, want a random safe Shelley emoji", code, got)
	}
	if got.Href != faviconHref(got.Emoji) {
		t.Fatalf("GET = %+v, want its href", got)
	}

	for _, emoji := range []string{"👩‍💻", "🇯🇵", "1️⃣", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "Σ", " 🦦 "} {
		code, got = do(http.MethodPut, `{"emoji":"`+emoji+`"}`)
		want := strings.TrimSpace(emoji)
		if code != http.StatusOK || got.Emoji != want || got.Source != "shelley" || got.Href != faviconHref(want) {
			t.Fatalf("PUT %q = %d %+v", emoji, code, got)
		}
	}
	for _, bad := range []string{
		"", " ", "🦦🦦", "ab", "\t", `\u0007`, // empty, space, several, control
		`\u200d`, `\ufe0f`, `\u200b`, `\u00ad`, `\u202e`, // lone joiner, selector, invisible format runes
		`\u3164`, `\u115f`, `\uffa0`, `\u2800`, // blank fillers
		`\ue000`, `\uffff`, // private use; forbidden in XML
	} {
		if code, _ := do(http.MethodPut, `{"emoji":"`+bad+`"}`); code != http.StatusBadRequest {
			t.Fatalf("PUT %q = %d, want 400", bad, code)
		}
	}
	if code, got = do(http.MethodGet, ""); got.Emoji != "🦦" {
		t.Fatalf("GET after PUT = %d %+v, want 🦦", code, got)
	}

	reflection = "🧪"
	if code, got = do(http.MethodGet, ""); got.Emoji != "🧪" || got.Source != "exe.dev" {
		t.Fatalf("GET with reflection = %d %+v, want exe.dev 🧪", code, got)
	}
}

// A full disk must not take the whole UI down with it: the page still loads
// with an unsaved random emoji, and a later load stores one.
func TestIndexServesUnsavedEmojiOnFullDisk(t *testing.T) {
	srv, database, _ := newTestServer(t)
	srv.reflectionEmoji = func(context.Context) string { return "" }
	fillTestDB(t, database)

	svg := indexFaviconSVG(t, srv)
	if !slices.ContainsFunc(safeFaviconEmojis, func(e string) bool { return strings.Contains(svg, ">"+e+"</text>") }) {
		t.Fatalf("favicon does not use a safe emoji: %s", svg)
	}
	if stored, err := database.GetSetting(t.Context(), faviconEmojiSettingKey); err != nil || stored != "" {
		t.Fatalf("stored %q (err %v) on a full disk", stored, err)
	}

	if err := database.Pool().Exec(t.Context(), "PRAGMA max_page_count=1073741823"); err != nil {
		t.Fatal(err)
	}
	indexFaviconSVG(t, srv)
	if stored, err := database.GetSetting(t.Context(), faviconEmojiSettingKey); err != nil || stored == "" {
		t.Fatalf("stored %q (err %v) after space freed", stored, err)
	}
}
