package server

import (
	"context"
	"encoding/json"

	"shelley.exe.dev/db/generated"
	"shelley.exe.dev/llm"
)

// defaultKeepRecentTokens is the default budget of recent history
// compact_in_place leaves as it is (see recentStart).
const defaultKeepRecentTokens = 20000

// keepRecentTokens is the budget of recent history compact_in_place leaves as
// it is.
func (s *Server) keepRecentTokens() int {
	if s.keepRecentTokensOverride > 0 {
		return s.keepRecentTokensOverride
	}
	return defaultKeepRecentTokens
}

// piImageTokens is pi's estimate for an image (4800 chars). The size of its
// base64 data says little: a 1280x720 screenshot is ~1.2k tokens.
const piImageTokens = 1200

// estimatePiMessageTokens ports pi's character/4 heuristic for one message.
func estimatePiMessageTokens(msg llm.Message) int {
	chars, images := 0, 0
	for _, c := range msg.Content {
		switch c.Type {
		case llm.ContentTypeText:
			chars += len(c.Text)
			if c.MediaType != "" {
				images++
			}
		case llm.ContentTypeThinking, llm.ContentTypeRedactedThinking:
			chars += len(c.Thinking)
		case llm.ContentTypeToolUse:
			chars += len(c.ToolName) + len(c.ToolInput)
		case llm.ContentTypeToolResult:
			for _, r := range c.ToolResult {
				chars += len(r.Text)
				if r.MediaType != "" {
					images++
				}
			}
		}
	}
	// ceil(chars / 4)
	return (chars+3)/4 + images*piImageTokens
}

// isToolResultMessage reports whether a message carries only tool_result
// content. Such messages are never valid cut points: they must stay paired
// with the assistant tool_use that produced them.
func isToolResultMessage(msg llm.Message) bool {
	hasToolResult := false
	for _, c := range msg.Content {
		if c.Type == llm.ContentTypeToolResult {
			hasToolResult = true
		} else if c.Type != llm.ContentTypeText {
			// Other content alongside tool_result is unusual; treat presence
			// of a non-tool-result, non-text block as making this not a pure
			// tool-result message.
			return false
		}
	}
	return hasToolResult
}

// findPiCutPoint ports pi's findCutPoint to a flat message list. It returns the
// index of the first message to KEEP verbatim. Messages [0, cut) are
// summarized; [cut, len) are kept. The cut never lands on a tool_result
// message, so kept history never starts with an orphaned tool result.
func findPiCutPoint(messages []llm.Message, keepRecentTokens int) int {
	// Collect valid cut points (non-tool-result messages).
	var cutPoints []int
	for i, m := range messages {
		if !isToolResultMessage(m) {
			cutPoints = append(cutPoints, i)
		}
	}
	if len(cutPoints) == 0 {
		// No valid cut point: keep everything, summarize nothing.
		return 0
	}

	cutIndex := cutPoints[0]
	accumulated := 0
	for i := len(messages) - 1; i >= 0; i-- {
		accumulated += estimatePiMessageTokens(messages[i])
		if accumulated >= keepRecentTokens {
			// Pick the first valid cut point at or after i. If a tool
			// result alone fills the budget there is none: keep it with
			// its call, the last cut point.
			cutIndex = cutPoints[len(cutPoints)-1]
			for _, c := range cutPoints {
				if c >= i {
					cutIndex = c
					break
				}
			}
			break
		}
	}
	return cutIndex
}

// resolveDistilledContent returns the summary text of a message written by
// the removed distill-into-new-generation flow, whose llm_data may only hold a
// placeholder ("Distillation written to ..."); the summary lives in user_data.
// Returns ok=false when the message is not such a message.
func resolveDistilledContent(m generated.Message) (string, bool) {
	if m.UserData == nil {
		return "", false
	}
	var userData map[string]string
	if err := json.Unmarshal([]byte(*m.UserData), &userData); err != nil {
		return "", false
	}
	if userData["distilled"] != "true" {
		return "", false
	}
	return userData["distillation_content"], true
}

// logWarner is the subset of *slog.Logger used to report bad rows.
type logWarner interface {
	Warn(msg string, args ...any)
}

// broadcastEstimatedContextSize estimates the latest generation's context
// window usage (char/4 heuristic over context-eligible messages) and pushes it
// to stream subscribers. Used right after /compact-debug, when no turn has
// reported the compacted context's usage yet.
func (s *Server) broadcastEstimatedContextSize(ctx context.Context, conversationID string) {
	s.mu.Lock()
	manager, ok := s.activeConversations[conversationID]
	s.mu.Unlock()
	if !ok {
		return
	}

	messages, err := s.db.ListMessages(ctx, conversationID)
	if err != nil {
		s.logger.Error("Failed to list messages for context estimate", "conversationID", conversationID, "error", err)
		return
	}

	// Estimate over the conversation's CURRENT generation, not the max
	// generation present in the table: a rolled-back compaction leaves
	// abandoned higher-generation rows behind, and estimating those would
	// show a near-empty context for an intact conversation.
	conv, err := s.db.GetConversationByID(ctx, conversationID)
	if err != nil {
		s.logger.Error("Failed to load conversation for context estimate", "conversationID", conversationID, "error", err)
		return
	}
	latestGen := conv.CurrentGeneration

	var contextRows []generated.Message
	for _, m := range messages {
		if m.Generation == latestGen && !m.ExcludedFromContext {
			contextRows = append(contextRows, m)
		}
	}
	items, system, err := manager.contextItems(contextRows)
	if err != nil {
		s.logger.Error("Failed to build context for estimate", "conversationID", conversationID, "error", err)
		return
	}
	var estimate int64
	for _, sc := range system {
		estimate += int64(estimatePiMessageTokens(llm.Message{Content: []llm.Content{{Type: llm.ContentTypeText, Text: sc.Text}}}))
	}
	for _, it := range items {
		estimate += int64(estimatePiMessageTokens(it.message))
	}
	if estimate <= 0 {
		return
	}

	var conversation generated.Conversation
	if derr := s.db.Queries(ctx, func(q *generated.Queries) error {
		var qerr error
		conversation, qerr = q.GetConversation(ctx, conversationID)
		return qerr
	}); derr != nil {
		s.logger.Error("Failed to get conversation for context estimate", "conversationID", conversationID, "error", derr)
		return
	}

	manager.broadcastStream(StreamResponse{
		Conversation:      &conversation,
		ContextWindowSize: uint64(estimate),
	})
}
