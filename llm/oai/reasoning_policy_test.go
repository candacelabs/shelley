package oai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/sashabaranov/go-openai"
	"shelley.exe.dev/llm"
)

func TestServiceDoReasoningPolicy(t *testing.T) {
	routes := []struct{ name, provider, endpoint, model string }{
		{"Fireworks", "fireworks", FireworksURL, "accounts/fireworks/models/glm-5p3"},
		{"DeepSeek", "openai", "https://api.deepseek.com/v1", "deepseek-v4-pro"},
		{"Moonshot", "openai", MoonshotURL, "kimi-k3"},
		{"OpenAI", "openai", OpenAIURL, "gpt-6-luna"},
	}
	for routeIndex, route := range routes {
		for _, streaming := range []bool{false, true} {
			for _, tt := range []struct {
				name        string
				thinking    []string
				want        [4]*string
				replay      ReasoningReplay
				otherModel  bool
				withoutTool bool
			}{
				// Expected outgoing reasoning: Fireworks, DeepSeek, Moonshot, OpenAI.
				{name: "missing", want: [4]*string{nil, new(""), new(""), nil}},
				{name: "empty", thinking: []string{""}, want: [4]*string{nil, new(""), new(""), nil}},
				{name: "space", thinking: []string{" "}, want: [4]*string{nil, new(" "), new(" "), nil}},
				{name: "whitespace", thinking: []string{" \t\r\n\u00a0"}, want: [4]*string{nil, new(" \t\r\n\u00a0"), new(" \t\r\n\u00a0"), nil}},
				{name: "multiple blank blocks", thinking: []string{" ", "\n"}, want: [4]*string{nil, new(" \n\n"), new(" \n\n"), nil}},
				{name: "missing without tool", withoutTool: true},
				{name: "blank without tool", thinking: []string{" "}, withoutTool: true, want: [4]*string{nil, new(" "), new(" "), nil}},
				{name: "meaningful", thinking: []string{" \nInspect the result.\t "}, want: [4]*string{new(" \nInspect the result.\t "), new(" \nInspect the result.\t "), new(" \nInspect the result.\t "), nil}},
				{name: "mixed blocks", thinking: []string{" ", "Think.", "\n"}, want: [4]*string{new(" \nThink.\n\n"), new(" \nThink.\n\n"), new(" \nThink.\n\n"), nil}},
				{name: "explicit replay", thinking: []string{"Think."}, want: [4]*string{new("Think."), new("Think."), new("Think."), new("Think.")}, replay: ReasoningReplayContent},
				{name: "disabled replay", thinking: []string{"Think."}, want: [4]*string{nil, new(""), nil, nil}, replay: ReasoningReplayNone},
				{name: "disabled replay without tool", thinking: []string{"Think."}, withoutTool: true, replay: ReasoningReplayNone},
				{name: "model switch", thinking: []string{"Other model's reasoning."}, otherModel: true, want: [4]*string{nil, new(""), new(""), nil}},
				{name: "model switch without tool", thinking: []string{"Other model's reasoning."}, otherModel: true, withoutTool: true},
			} {
				t.Run(fmt.Sprintf("%s/%s/stream=%t", route.name, tt.name, streaming), func(t *testing.T) {
					var request struct {
						Messages []map[string]json.RawMessage `json:"messages"`
						Stream   bool                         `json:"stream"`
					}
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
							t.Error(err)
						}
						// Provider output must remain intact, even when it is blank.
						if streaming {
							w.Header().Set("Content-Type", "text/event-stream")
							fmt.Fprint(w, "data: {\"id\":\"x\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"reasoning_content\":\" \"},\"finish_reason\":null}]}\n\n")
							fmt.Fprint(w, "data: {\"id\":\"x\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
							return
						}
						w.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(w).Encode(openai.ChatCompletionResponse{ID: "x", Choices: []openai.ChatCompletionChoice{{
							Message: openai.ChatCompletionMessage{Role: "assistant", ReasoningContent: " ", Content: "ok"}, FinishReason: "stop",
						}}})
					}))
					defer server.Close()

					target, err := url.Parse(server.URL)
					if err != nil {
						t.Fatal(err)
					}
					svc := &Service{
						APIKey: "k", Model: modelForTest(route.model),
						ModelURL: route.endpoint, ProviderName: route.provider, ReasoningReplay: tt.replay,
						HTTPC: &http.Client{Transport: rewriteHostTransport{addr: target.Host}},
					}
					origin := svc.messageOrigin(svc.Model)
					if tt.otherModel {
						origin.Model = "other-model"
					}
					msg := llm.Message{Role: llm.MessageRoleAssistant, Origin: &origin}
					for _, thinking := range tt.thinking {
						msg.Content = append(msg.Content, llm.Content{Type: llm.ContentTypeThinking, Thinking: thinking})
					}
					if tt.withoutTool {
						msg.Content = append(msg.Content, llm.Content{Type: llm.ContentTypeText, Text: "answer"})
					} else {
						msg.Content = append(msg.Content, llm.Content{Type: llm.ContentTypeToolUse, ID: "call_1", ToolName: "x", ToolInput: json.RawMessage(`{}`)})
					}
					ir := &llm.Request{Messages: []llm.Message{msg}}
					before, err := json.Marshal(ir.Messages)
					if err != nil {
						t.Fatal(err)
					}
					var deltas []llm.StreamDelta
					if streaming {
						ir.OnStream = func(delta llm.StreamDelta) { deltas = append(deltas, delta) }
					}
					response, err := svc.Do(t.Context(), ir)
					if err != nil {
						t.Fatal(err)
					}
					if len(request.Messages) != 1 {
						t.Fatalf("messages = %+v", request.Messages)
					}
					if request.Stream != streaming {
						t.Fatalf("stream = %v, want %v", request.Stream, streaming)
					}
					field, present := request.Messages[0]["reasoning_content"]
					if present != (tt.want[routeIndex] != nil) {
						t.Fatalf("reasoning_content present = %v, want %v: %s", present, tt.want[routeIndex] != nil, field)
					}
					if present {
						var got *string
						if err := json.Unmarshal(field, &got); err != nil {
							t.Fatal(err)
						}
						if got == nil || *got != *tt.want[routeIndex] {
							t.Fatalf("reasoning_content = %s, want %q", field, *tt.want[routeIndex])
						}
					}
					after, err := json.Marshal(ir.Messages)
					if err != nil {
						t.Fatal(err)
					}
					if !bytes.Equal(before, after) {
						t.Fatal("request conversion mutated history")
					}
					if len(response.Content) != 2 || response.Content[0].Type != llm.ContentTypeThinking || response.Content[0].Thinking != " " {
						t.Fatalf("provider response was altered: %+v", response.Content)
					}
					if streaming && (len(deltas) != 2 || deltas[0].Type != "thinking" || deltas[0].Text != " " || deltas[0].Index != 0 || deltas[1].Index != 1) {
						t.Fatalf("provider stream was altered: %+v", deltas)
					}
				})
			}
		}
	}
}
