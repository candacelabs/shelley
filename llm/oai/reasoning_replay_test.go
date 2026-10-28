package oai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/sashabaranov/go-openai"
	"shelley.exe.dev/llm"
)

func TestResolveReasoningReplay(t *testing.T) {
	tests := []struct {
		name       string
		endpoint   string
		model      string
		configured ReasoningReplay
		want       ReasoningReplay
	}{
		{
			name: "auto native Fireworks", endpoint: "https://llm.int.exe.xyz/v1",
			model: "accounts/fireworks/models/glm-5p3", configured: ReasoningReplayAuto, want: ReasoningReplayContent,
		},
		{
			name: "auto public Fireworks slug", endpoint: "https://proxy.example/v1",
			model: "fireworks/kimi-k3", want: ReasoningReplayContent,
		},
		{
			name: "auto bare Fireworks name", endpoint: "https://proxy.example/v1",
			model: "glm-5p3", want: ReasoningReplayContent,
		},
		{
			name: "qualified OpenRouter model does not inherit Fireworks metadata", endpoint: "https://openrouter.ai/api/v1",
			model: "moonshotai/kimi-k3",
		},
		{
			name: "auto unsupported models.dev field", endpoint: "https://openrouter.ai/api/v1",
			model: "xiaomi/mimo-v2.5", want: ReasoningReplayNone,
		},
		{
			name: "auto without metadata", endpoint: "https://llm.int.exe.xyz/v1",
			model: "accounts/fireworks/models/gpt-oss-120b",
		},
		{name: "explicit enable", endpoint: "https://example.test/v1", model: "custom", configured: ReasoningReplayContent, want: ReasoningReplayContent},
		{name: "explicit disable", endpoint: "https://api.deepseek.com", model: "deepseek-v4-pro", configured: ReasoningReplayNone, want: ReasoningReplayNone},
		{name: "unsupported mode disables replay", endpoint: "https://example.test/v1", model: "custom", configured: "reasoning_details", want: ReasoningReplayNone},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveReasoningReplay(tt.endpoint, tt.model, tt.configured); got != tt.want {
				t.Fatalf("ResolveReasoningReplay() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestServiceDoAutoReasoningReplayEmptyField(t *testing.T) {
	for _, tt := range []struct {
		name     string
		endpoint string
		model    string
		provider string
		want     bool
	}{
		{
			name: "Moonshot native metadata", endpoint: "https://api.moonshot.ai/v1",
			model: "kimi-k3", want: true,
		},
		{
			name: "OpenRouter exact slug does not inherit native metadata", endpoint: "https://openrouter.ai/api/v1",
			model: "moonshotai/kimi-k3",
		},
		{
			name: "Fireworks provider through gateway", endpoint: "https://llm.int.exe.xyz/v1",
			model: "glm-5p3", provider: "fireworks",
		},
		{
			name: "custom Fireworks endpoint", endpoint: FireworksURL,
			model: "glm-5p3", provider: "openai",
		},
		{
			name: "native Fireworks ID through gateway", endpoint: "https://llm.int.exe.xyz/v1",
			model: "accounts/fireworks/models/glm-5p3", provider: "openai",
		},
		{
			name: "public Fireworks slug through gateway", endpoint: "https://llm.int.exe.xyz/v1",
			model: "fireworks/kimi-k3", provider: "openai",
		},
		{
			name: "bare name does not identify Fireworks", endpoint: "https://proxy.example/v1",
			model: "glm-5p3", want: true,
		},
		{
			name: "lookalike hostname is not Fireworks", endpoint: "https://api.fireworks.ai.example/v1",
			model: "glm-5p3", want: true,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var request struct {
				Messages []map[string]json.RawMessage `json:"messages"`
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(openai.ChatCompletionResponse{ID: "x", Choices: []openai.ChatCompletionChoice{{
					Message: openai.ChatCompletionMessage{Role: "assistant", Content: "ok"}, FinishReason: "stop",
				}}})
			}))
			defer server.Close()

			u, err := url.Parse(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			svc := &Service{
				APIKey: "k", Model: modelForTest(tt.model), ModelURL: tt.endpoint,
				HTTPC: &http.Client{Transport: rewriteHostTransport{addr: u.Host}}, ProviderName: tt.provider,
			}
			_, err = svc.Do(t.Context(), &llm.Request{Messages: []llm.Message{{
				Role:    llm.MessageRoleAssistant,
				Content: []llm.Content{{Type: llm.ContentTypeToolUse, ID: "call_1", ToolName: "x", ToolInput: json.RawMessage(`{}`)}},
			}}})
			if err != nil {
				t.Fatal(err)
			}
			if len(request.Messages) != 1 {
				t.Fatalf("messages = %+v", request.Messages)
			}
			field, present := request.Messages[0]["reasoning_content"]
			if present != tt.want || present && string(field) != `""` {
				t.Fatalf("reasoning_content = %s (present %v), want empty field %v", field, present, tt.want)
			}
		})
	}
}
