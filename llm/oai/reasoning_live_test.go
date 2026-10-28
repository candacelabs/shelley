package oai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"shelley.exe.dev/llm"
)

// TestLiveReasoning records endpoint contracts separately from Shelley's policy.
// Run with -count=1 so a scheduled check cannot reuse Go's test cache.
func TestLiveReasoning(t *testing.T) {
	if os.Getenv("SHELLEY_OAI_LIVE_TESTS") != "1" {
		t.Skip("set SHELLEY_OAI_LIVE_TESTS=1 to run live provider tests")
	}
	for _, route := range []struct {
		name, key, endpoint, model, effort string
		// Expected HTTP status: omitted, null, empty, space, meaningful.
		status [5]int
	}{
		{"fireworks", "FIREWORKS_API_KEY", FireworksURL, "accounts/fireworks/models/glm-5p3", "low", [5]int{200, 200, 200, 200, 200}},
		{"fireworks-deepseek", "FIREWORKS_API_KEY", FireworksURL, "accounts/fireworks/models/deepseek-v4p1-flash", "low", [5]int{200, 200, 200, 200, 200}},
		{"fireworks-kimi", "FIREWORKS_API_KEY", FireworksURL, "accounts/fireworks/models/kimi-k3", "low", [5]int{200, 200, 200, 200, 200}},
		{"openai", "OPENAI_API_KEY", OpenAIURL, "gpt-6-luna", "none", [5]int{200, 200, 200, 200, 200}},
		{"deepseek", "DEEPSEEK_API_KEY", "https://api.deepseek.com/v1", "deepseek-flash", "low", [5]int{400, 400, 200, 200, 200}},
		{"zai", "ZAI_API_KEY", "https://api.z.ai/api/paas/v4", "glm-5.3", "low", [5]int{200, 200, 200, 200, 200}},
		{"moonshot", "MOONSHOT_API_KEY", MoonshotURL, "kimi-k3", "low", [5]int{200, 200, 200, 200, 200}},
	} {
		t.Run(route.name, func(t *testing.T) {
			key := os.Getenv(route.key)
			if key == "" {
				t.Skipf("%s is not set", route.key)
			}
			t.Parallel()
			client := &http.Client{Timeout: 90 * time.Second}
			tool := &llm.Tool{
				Name: "lookup_number", Description: "Look up the number.",
				InputSchema: llm.MustSchema(`{"type":"object","properties":{}}`),
			}
			user := llm.Message{Role: llm.MessageRoleUser, Content: []llm.Content{{
				Type: llm.ContentTypeText, Text: "Call lookup_number, then reply with its number only.",
			}}}
			toolResult := llm.Message{Role: llm.MessageRoleUser, Content: []llm.Content{{
				Type: llm.ContentTypeToolResult, ToolUseID: "call_number",
				ToolResult: []llm.Content{{Type: llm.ContentTypeText, Text: "42"}},
			}}}

			// Raw JSON is deliberate: the SDK cannot distinguish omission from "".
			for index, variant := range []struct {
				name  string
				value any
			}{
				{"omitted", nil},
				{"null", nil},
				{"empty", ""},
				{"space", " "},
				{"meaningful", " \nI will look up the number.\t "},
			} {
				t.Run("wire/"+variant.name, func(t *testing.T) {
					assistant := map[string]any{
						"role": "assistant", "content": "",
						"tool_calls": []any{map[string]any{
							"id": "call_number", "type": "function",
							"function": map[string]any{"name": tool.Name, "arguments": "{}"},
						}},
					}
					if variant.name != "omitted" {
						assistant["reasoning_content"] = variant.value
					}
					body := map[string]any{
						"model":    route.model,
						"tools":    []any{fromLLMTool(tool)},
						"messages": []any{fromLLMMessage(user)[0], assistant, fromLLMMessage(toolResult)[0]},
					}
					if route.name == "openai" {
						body["max_completion_tokens"] = 1024
					} else {
						body["max_tokens"] = 1024
					}
					if route.effort != "" {
						body["reasoning_effort"] = route.effort
					}
					encoded, err := json.Marshal(body)
					if err != nil {
						t.Fatal(err)
					}
					req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, route.endpoint+"/chat/completions", bytes.NewReader(encoded))
					if err != nil {
						t.Fatal(err)
					}
					req.Header.Set("Authorization", "Bearer "+key)
					req.Header.Set("Content-Type", "application/json")
					resp, err := client.Do(req)
					if err != nil {
						t.Fatal(err)
					}
					defer resp.Body.Close()
					t.Logf("raw probe HTTP %d", resp.StatusCode)
					data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
					if err != nil {
						t.Fatal(err)
					}
					wantStatus := route.status[index]
					if resp.StatusCode != wantStatus {
						t.Fatalf("HTTP %d, want %d: %s", resp.StatusCode, wantStatus, data)
					}
					if wantStatus == http.StatusBadRequest {
						if !bytes.Contains(data, []byte("reasoning_content")) {
							t.Fatalf("expected reasoning rejection: %s", data)
						}
						return
					}
					var result struct {
						Choices []struct {
							Message struct {
								Content   string
								Reasoning string `json:"reasoning_content"`
							}
							Finish string `json:"finish_reason"`
						}
					}
					if err := json.Unmarshal(data, &result); err != nil {
						t.Fatal(err)
					}
					if len(result.Choices) != 1 || result.Choices[0].Finish != "stop" || strings.TrimSpace(result.Choices[0].Message.Content) != "42" {
						t.Fatalf("expected final answer 42: %s", data)
					}
					checkLiveThinking(t, result.Choices[0].Message.Reasoning)
				})
			}

			provider, _, _ := strings.Cut(route.name, "-")
			svc := &Service{
				APIKey: key, ModelURL: route.endpoint, Model: modelForTest(route.model),
				ProviderName: provider, ReasoningEffort: route.effort, MaxTokens: 1024, HTTPC: client,
			}
			for _, streaming := range []bool{false, true} {
				t.Run(fmt.Sprintf("adapter/stream=%t", streaming), func(t *testing.T) {
					call := func(messages []llm.Message) *llm.Response {
						t.Helper()
						ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
						defer cancel()
						req := &llm.Request{Messages: messages, Tools: []*llm.Tool{tool}}
						var text, thinking strings.Builder
						if streaming {
							req.OnStream = func(delta llm.StreamDelta) {
								switch delta.Type {
								case "text":
									text.WriteString(delta.Text)
								case "thinking":
									thinking.WriteString(delta.Text)
								}
							}
						}
						response, err := svc.Do(ctx, req)
						if err != nil {
							t.Fatal(err)
						}
						checkLiveThinking(t, liveContent(response, llm.ContentTypeThinking))
						if response.StopReason != llm.StopReasonStopSequence && response.StopReason != llm.StopReasonToolUse {
							t.Fatalf("unexpected stop reason: %s", response.StopReason)
						}
						if streaming && (text.String() != liveContent(response, llm.ContentTypeText) || thinking.String() != liveContent(response, llm.ContentTypeThinking)) {
							t.Fatal("streamed content differs from the accumulated response")
						}
						return response
					}
					first := call([]llm.Message{user})
					var calls []llm.Content
					for _, block := range first.Content {
						if block.Type == llm.ContentTypeToolUse {
							calls = append(calls, block)
						}
					}
					if first.StopReason != llm.StopReasonToolUse || len(calls) != 1 || calls[0].ToolName != tool.Name || calls[0].ID == "" {
						t.Fatalf("expected one lookup_number call: %+v", calls)
					}
					var args map[string]json.RawMessage
					if err := json.Unmarshal(calls[0].ToolInput, &args); err != nil || args == nil || len(args) != 0 {
						t.Fatalf("expected empty tool arguments object, got %s", calls[0].ToolInput)
					}
					result := llm.Message{Role: toolResult.Role, Content: append([]llm.Content(nil), toolResult.Content...)}
					result.Content[0].ToolUseID = calls[0].ID
					history := []llm.Message{user, {Role: llm.MessageRoleAssistant, Content: first.Content, Origin: first.Origin}, result}
					final := call(history)
					if strings.TrimSpace(liveContent(final, llm.ContentTypeText)) != "42" || final.StopReason == llm.StopReasonToolUse {
						t.Fatalf("expected final answer 42: %+v", final.Content)
					}
					// Switching models must keep the tool transcript usable after
					// filtering the previous model's reasoning.
					history[1].Origin = &llm.MessageOrigin{Provider: "other", Transport: "other", Model: "other"}
					history[1].Content = append([]llm.Content{{Type: llm.ContentTypeThinking, Thinking: "Other model's reasoning."}}, calls...)
					final = call(history)
					if strings.TrimSpace(liveContent(final, llm.ContentTypeText)) != "42" || final.StopReason == llm.StopReasonToolUse {
						t.Fatalf("model switch did not complete: %+v", final.Content)
					}
				})
			}
		})
	}
}

func checkLiveThinking(t *testing.T, thinking string) {
	t.Helper()
	if thinking != "" && strings.TrimSpace(thinking) == "" {
		t.Fatalf("provider emitted %d bytes of whitespace-only thinking", len(thinking))
	}
	t.Logf("returned thinking: %d bytes", len(thinking))
}

func liveContent(response *llm.Response, kind llm.ContentType) string {
	var text strings.Builder
	for _, block := range response.Content {
		if block.Type == kind {
			if kind == llm.ContentTypeThinking {
				text.WriteString(block.Thinking)
			} else {
				text.WriteString(block.Text)
			}
		}
	}
	return text.String()
}
