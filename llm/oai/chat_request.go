package oai

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"

	"github.com/sashabaranov/go-openai"
)

// chatRequestMessage distinguishes omitted reasoning from an explicitly empty
// string. The SDK's string field with omitempty cannot represent the latter.
type chatRequestMessage struct {
	Role             string               `json:"role"`
	Content          any                  `json:"content,omitempty"`
	Refusal          string               `json:"refusal,omitempty"`
	Name             string               `json:"name,omitempty"`
	ReasoningContent *string              `json:"reasoning_content,omitempty"`
	FunctionCall     *openai.FunctionCall `json:"function_call,omitempty"`
	ToolCalls        []openai.ToolCall    `json:"tool_calls,omitempty"`
	ToolCallID       string               `json:"tool_call_id,omitempty"`
}

// prepareChatRequest applies reasoning policy to the outgoing request. A nil
// body leaves serialization to the SDK; only an explicit empty reasoning field
// needs Shelley's serializer.
func prepareChatRequest(req *openai.ChatCompletionRequest, policy reasoningPolicy) ([]byte, error) {
	needsEmptyField := false
	messages := make([]chatRequestMessage, len(req.Messages))
	for i, m := range req.Messages {
		if m.Content != "" && m.MultiContent != nil {
			return nil, openai.ErrContentFieldsMisused
		}
		reasoning := policy.content(m)
		req.Messages[i].ReasoningContent = ""
		if reasoning != nil {
			req.Messages[i].ReasoningContent = *reasoning
			needsEmptyField = needsEmptyField || *reasoning == ""
		}
		messages[i] = chatRequestMessage{
			Role: m.Role, Refusal: m.Refusal, Name: m.Name,
			ReasoningContent: reasoning, FunctionCall: m.FunctionCall,
			ToolCalls: m.ToolCalls, ToolCallID: m.ToolCallID,
		}
		if len(m.MultiContent) > 0 {
			messages[i].Content = m.MultiContent
		} else if m.Content != "" {
			messages[i].Content = m.Content
		}
	}
	if !needsEmptyField {
		return nil, nil
	}
	return json.Marshal(struct {
		openai.ChatCompletionRequest
		Messages []chatRequestMessage `json:"messages"`
	}{*req, messages})
}

// chatRequestClient supplies Shelley's serialized body through the SDK's HTTP
// hook. Each Service.Do has its own client/body, reused across retry attempts.
// The SDK still handles authentication, response decoding, and stream framing.
type chatRequestClient struct {
	client *http.Client
	body   []byte
}

func (c chatRequestClient) Do(req *http.Request) (*http.Response, error) {
	if err := req.Body.Close(); err != nil {
		return nil, err
	}
	req.GetBody = func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(c.body)), nil
	}
	req.Body = io.NopCloser(bytes.NewReader(c.body))
	req.ContentLength = int64(len(c.body))
	return c.client.Do(req)
}
