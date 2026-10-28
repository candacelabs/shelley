package server

import (
	"context"
	"errors"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"

	"shelley.exe.dev/claudetool"
	"shelley.exe.dev/llm"
	"shelley.exe.dev/llm/predictable"
	"shelley.exe.dev/models"
)

// voiceCatalog is a configured catalog: models from the free gateway, one
// from the user's own OpenAI key, and a custom one.
var voiceCatalog = map[string]models.ModelInfo{
	"model-a":           knownModel("gpt-6.1-sol", "exe.dev"),
	"model-b":           knownModel("claude-opus-5.5", "exe.dev"),
	"model-c":           knownModel("kimi-k3-fireworks", "exe.dev"),
	"gpt-5.6-terra":     knownModel("gpt-5.6-terra", "exe.dev"),
	"claude-sonnet-5.5": knownModel("claude-sonnet-5.5", "exe.dev"),
	"claude-haiku-5.5":  knownModel("claude-haiku-5.5", "exe.dev"),
	"gpt-6.1-sol-own":   knownModel("gpt-6.1-sol", "openai.key"),
	"gpt-5.6-terra-own": knownModel("gpt-5.6-terra", "openai.key"),
	"my-opus":           knownModel("claude-opus-5.5", models.SourceCustomLabel),
}

func knownModel(catalogID, source string) models.ModelInfo {
	m := models.ByID(catalogID)
	return models.ModelInfo{Provider: m.Provider, APIModelName: m.APIModelName, Source: source, BaseURL: "https://" + source, ReleaseDate: "2026-01-01"}
}

// voiceModels serves voiceCatalog from one backend that records which model
// was asked and answers with reply or err.
type voiceModels struct {
	mu    sync.Mutex
	asked []string
	reply string
	err   error
}

type voiceModel struct {
	llm.Service // a predictable service, for everything but Do
	*voiceModels
	id string
}

func (m voiceModel) Do(ctx context.Context, req *llm.Request) (*llm.Response, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.asked = append(m.asked, m.id)
	if m.err != nil {
		return nil, m.err
	}
	return &llm.Response{Role: llm.MessageRoleAssistant, StopReason: llm.StopReasonEndTurn, Content: []llm.Content{llm.StringContent(m.reply)}}, nil
}

func (m *voiceModels) GetService(id string) (llm.Service, error) {
	if !m.HasModel(id) {
		return nil, os.ErrNotExist
	}
	return voiceModel{predictable.NewService(), m, id}, nil
}

func (m *voiceModels) GetWorkhorseService(id string) (llm.Service, error) { return m.GetService(id) }

func (m *voiceModels) GetAvailableModels() []string {
	return slices.Sorted(maps.Keys(voiceCatalog))
}
func (m *voiceModels) HasModel(id string) bool { _, ok := voiceCatalog[id]; return ok }
func (m *voiceModels) GetModelInfo(id string) *models.ModelInfo {
	if info, ok := voiceCatalog[id]; ok {
		return &info
	}
	return nil
}
func (m *voiceModels) RefreshCustomModels() error { return nil }

// A voice prompt is written by a middle-tier model of the profile model's
// provider and source, so the same account pays, or else by the profile's
// model; from the system prompt alone, without reasoning or tools. What is
// wrong with the result is safe to show; a provider's errors are not.
func TestVoicePromptGenerate(t *testing.T) {
	t.Parallel()
	database, cleanup := setupTestDB(t)
	t.Cleanup(cleanup)
	catalog := &voiceModels{reply: " You are Juniper. Speak warmly.\n"}
	srv := NewServer(database, catalog, claudetool.ToolSetConfig{},
		slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelWarn})), false, "model-a", "")
	generate := func(body string) (int, string) {
		w := httptest.NewRecorder()
		srv.handleGenerateVoicePrompt(w, httptest.NewRequest(http.MethodPost, "/api/profiles/voice-prompt/generate", strings.NewReader(body)))
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for model, want := range map[string]string{
		"":                  "gpt-5.6-terra",     // the server's default, model-a
		"model-b":           "claude-sonnet-5.5", // not haiku
		"claude-sonnet-5.5": "claude-sonnet-5.5", // already middle-tier
		"model-c":           "model-c",           // its provider has no preferred family
		"gpt-6.1-sol-own":   "gpt-5.6-terra-own", // the same account, not the gateway's terra
		"my-opus":           "my-opus",           // a custom source names no account
	} {
		code, got := generate(`{"model":"` + model + `","system_prompt":"You are Juniper, a cozy assistant."}`)
		if code != http.StatusOK || got != `{"voice_prompt":"You are Juniper. Speak warmly."}` {
			t.Fatalf("%q: %d %s", model, code, got)
		}
		if asked := catalog.asked[len(catalog.asked)-1]; asked != want {
			t.Errorf("%q: written by %s, want %s", model, asked, want)
		}
	}
	if code, got := generate(`{"model":"nope"}`); code != http.StatusBadRequest {
		t.Errorf("unknown model: %d %s", code, got)
	}

	catalog.err = errors.New("PROVIDER-SECRET")
	if code, got := generate(`{}`); code != http.StatusBadGateway || got != "Could not generate a voice prompt" {
		t.Errorf("provider error: %d %s", code, got)
	}
	catalog.err, catalog.reply = nil, " "
	if code, got := generate(`{}`); code != http.StatusBadGateway || got != "voice prompt: the model wrote none" {
		t.Errorf("empty: %d %s", code, got)
	}
}
