package server

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"shelley.exe.dev/db"
	"shelley.exe.dev/llm"
)

func TestSubagentUsageIncludesOtherUsage(t *testing.T) {
	t.Parallel()
	srv, database, _ := newTestServer(t)
	ctx := t.Context()

	parent, err := database.CreateConversation(ctx, nil, true, nil, nil, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	child, err := database.CreateSubagentConversation(ctx, "sub-other-usage", parent.ConversationID, nil)
	if err != nil {
		t.Fatal(err)
	}

	// Child main-loop usage: 1M in + 1M out of claude-opus-4-6 = $30 estimated.
	if _, err := database.CreateMessage(ctx, db.CreateMessageParams{
		ConversationID: child.ConversationID,
		Type:           db.MessageTypeAgent,
		UsageData: map[string]any{
			"input_tokens": 1_000_000, "output_tokens": 1_000_000, "cost_usd": 1.25,
		},
		ModelName: "claude-opus-4-6",
		LLMAPIURL: "https://llm.int.exe.xyz/v1/messages",
	}); err != nil {
		t.Fatal(err)
	}
	// Child indirect usage (a tool-result message's other_usage_data): another
	// 1M in of the same model = $5 estimated.
	if _, err := database.CreateMessage(ctx, db.CreateMessageParams{
		ConversationID: child.ConversationID,
		Type:           db.MessageTypeUser,
		LLMData:        llm.Message{Role: llm.MessageRoleUser},
		OtherUsageData: []llm.PurposedUsage{{
			Purpose: "keyword_search",
			Usage:   llm.Usage{InputTokens: 1_000_000, CostUSD: 0.75, Model: "claude-opus-4-6", URL: "https://llm.int.exe.xyz/v1/messages"},
		}},
	}); err != nil {
		t.Fatal(err)
	}
	// The parent's own indirect usage must NOT be counted.
	if _, err := database.CreateMessage(ctx, db.CreateMessageParams{
		ConversationID: parent.ConversationID,
		Type:           db.MessageTypeUser,
		LLMData:        llm.Message{Role: llm.MessageRoleUser},
		OtherUsageData: []llm.PurposedUsage{{
			Purpose: "compaction",
			Usage:   llm.Usage{InputTokens: 999, CostUSD: 9, Model: "claude-opus-4-6", URL: "https://llm.int.exe.xyz/v1/messages"},
		}},
	}); err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/conversation/"+parent.ConversationID+"/subagent-usage", nil)
	srv.handleSubagentUsage(w, req, parent.ConversationID)
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	var res struct {
		LLMCalls      int64   `json:"llm_calls"`
		EstimatedUsd  float64 `json:"estimated_usd"`
		ReportedUsd   float64 `json:"reported_usd"`
		UnpricedCalls int64   `json:"unpriced_calls"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.LLMCalls != 2 {
		t.Errorf("llm_calls = %d, want 2 (1 message + 1 indirect)", res.LLMCalls)
	}
	if res.EstimatedUsd < 34.99 || res.EstimatedUsd > 35.01 {
		t.Errorf("estimated_usd = %v, want ~35", res.EstimatedUsd)
	}
	if res.ReportedUsd != 2.0 {
		t.Errorf("reported_usd = %v, want 2.0", res.ReportedUsd)
	}
	if res.UnpricedCalls != 0 {
		t.Errorf("unpriced_calls = %d, want 0", res.UnpricedCalls)
	}
}
