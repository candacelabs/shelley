package oai

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/sashabaranov/go-openai"
	"shelley.exe.dev/llm"
)

func TestPrepareChatRequestPreservesOtherFields(t *testing.T) {
	req := openai.ChatCompletionRequest{
		Model: "custom", MaxTokens: 123, ReasoningEffort: "low", Stream: true,
		StreamOptions: &openai.StreamOptions{IncludeUsage: true},
		Messages: []openai.ChatCompletionMessage{
			{Role: "system", Content: "instructions"},
			{Role: "user", Name: "name", Content: `Literal {"reasoning_content":" "} stays unchanged.`},
			{Role: "user", MultiContent: []openai.ChatMessagePart{
				{Type: "text", Text: "image"},
				{Type: "image_url", ImageURL: &openai.ChatMessageImageURL{URL: "data:image/png;base64,aW1hZ2U=", Detail: "low"}},
			}},
			{Role: "assistant", Refusal: "refusal", ReasoningContent: "thinking", ToolCalls: []openai.ToolCall{{
				ID: "call_1", Type: "function", Function: openai.FunctionCall{Name: "lookup", Arguments: `{"text":" "}`},
			}}},
			{Role: "tool", ToolCallID: "call_1", Content: "result"},
			{Role: "assistant", FunctionCall: &openai.FunctionCall{Name: "legacy", Arguments: "{}"}},
			{Role: "assistant", ToolCalls: []openai.ToolCall{{
				ID: "call_2", Type: "function", Function: openai.FunctionCall{Name: "lookup", Arguments: "{}"},
			}}},
		},
	}
	before, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	after, err := prepareChatRequest(&req, reasoningPolicy{replay: true, requireToolField: true})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(after, []byte(`"reasoning_content":"thinking"`)) || !bytes.Contains(after, []byte(`"reasoning_content":""`)) {
		t.Fatalf("mixed request lost meaningful or explicit empty reasoning: %s", after)
	}
	decode := func(data []byte) map[string]any {
		t.Helper()
		var body map[string]any
		if err := json.Unmarshal(data, &body); err != nil {
			t.Fatal(err)
		}
		for _, m := range body["messages"].([]any) {
			delete(m.(map[string]any), "reasoning_content")
		}
		return body
	}
	if !reflect.DeepEqual(decode(before), decode(after)) {
		t.Fatalf("changed fields besides reasoning:\nbefore: %s\nafter: %s", before, after)
	}
	req.Messages[0].MultiContent = []openai.ChatMessagePart{}
	if _, err := prepareChatRequest(&req, reasoningPolicy{}); !errors.Is(err, openai.ErrContentFieldsMisused) {
		t.Fatalf("conflicting content fields: %v", err)
	}
}

func TestPrepareChatRequestUsesSDKUnlessEmptyFieldRequired(t *testing.T) {
	for _, tt := range []struct {
		name, endpoint, thinking string
		replay                   ReasoningReplay
		wantBody                 bool
		wantThinking             string
	}{
		{name: "ordinary request", endpoint: OpenAIURL},
		{name: "Fireworks blank", endpoint: FireworksURL, thinking: " \n", replay: ReasoningReplayContent},
		{name: "meaningful replay", endpoint: MoonshotURL, thinking: " Think.\n", replay: ReasoningReplayContent, wantThinking: " Think.\n"},
		{name: "disabled replay", endpoint: MoonshotURL, thinking: "Think.", replay: ReasoningReplayNone},
		{name: "required empty", endpoint: MoonshotURL, replay: ReasoningReplayContent, wantBody: true},
		{name: "DeepSeek disabled replay", endpoint: "https://api.deepseek.com/v1", thinking: "Think.", replay: ReasoningReplayNone, wantBody: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := openai.ChatCompletionRequest{Model: "custom", Messages: []openai.ChatCompletionMessage{{
				Role: "assistant", ReasoningContent: tt.thinking,
				ToolCalls: []openai.ToolCall{{ID: "call_1", Type: "function", Function: openai.FunctionCall{Name: "lookup", Arguments: "{}"}}},
			}}}
			body, err := prepareChatRequest(&req, resolveReasoningPolicy("openai", tt.endpoint, req.Model, tt.replay))
			if err != nil {
				t.Fatal(err)
			}
			if (body != nil) != tt.wantBody {
				t.Fatalf("custom body present = %v, want %v", body != nil, tt.wantBody)
			}
			if req.Messages[0].ReasoningContent != tt.wantThinking {
				t.Fatalf("prepared reasoning = %q, want %q", req.Messages[0].ReasoningContent, tt.wantThinking)
			}
		})
	}
}

func TestChatRequestBodySurvivesRedirect(t *testing.T) {
	bodies := make(chan []byte, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if r.Method != "POST" || r.ContentLength != int64(len(body)) {
			t.Errorf("method/length = %s/%d, body length %d", r.Method, r.ContentLength, len(body))
		}
		if r.Header.Get("Authorization") != "Bearer key" || r.Header.Get("OpenAI-Organization") != "org" {
			t.Error("lost authentication headers")
		}
		bodies <- body
		if r.URL.Path == "/chat/completions" {
			http.Redirect(w, r, "/final", http.StatusTemporaryRedirect)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}]}`)
	}))
	defer server.Close()
	svc := &Service{APIKey: "key", Org: "org", Model: modelForTest("custom"), ModelURL: server.URL, ReasoningReplay: ReasoningReplayContent}
	_, err := svc.Do(t.Context(), &llm.Request{Messages: []llm.Message{{
		Role: llm.MessageRoleAssistant, Content: []llm.Content{{
			Type: llm.ContentTypeToolUse, ID: "call_1", ToolName: "lookup", ToolInput: json.RawMessage(`{}`),
		}},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(bodies) != 2 {
		t.Fatalf("requests = %d, want 2", len(bodies))
	}
	first, redirected := <-bodies, <-bodies
	if !bytes.Equal(first, redirected) || !bytes.Contains(first, []byte(`"reasoning_content":""`)) {
		t.Fatalf("lost explicit empty field across redirect: %s / %s", first, redirected)
	}
}
