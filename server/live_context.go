package server

import (
	"context"
	"fmt"
	"math"
	"slices"

	"shelley.exe.dev/db/generated"
)

const (
	liveContextMessages  = 6   // user requests and final assistant replies kept
	liveContextPageRows  = 100 // rows read at a time, newest first, until enough are found
	liveContextItemRunes = 800 // per-item cap; keeps well under Live's input limit
)

// liveHistoryItem is one prior text turn in Live's session.input format.
type liveHistoryItem struct {
	Type    string            `json:"type"`
	Role    string            `json:"role"`
	Content []liveHistoryText `json:"content"`
}

type liveHistoryText struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// liveContext returns only the user's typed messages and final backend
// replies, the latest liveContextMessages of them however many tool rows
// lie between. Tool results, subagent reports, background jobs and other
// machine notices must not enter the Live session.
func (s *Server) liveContext(ctx context.Context, conversationID string) (items []liveHistoryItem, lastSeq int64, err error) {
	before := int64(math.MaxInt64)
	for len(items) < liveContextMessages {
		var rows []generated.Message
		err = s.db.Queries(ctx, func(q *generated.Queries) error {
			var err error
			rows, err = q.ListMessagesBefore(ctx, generated.ListMessagesBeforeParams{ConversationID: conversationID, SequenceID: before, Limit: liveContextPageRows})
			return err
		})
		if err != nil {
			return nil, 0, fmt.Errorf("load live context: %w", err)
		}
		if len(rows) == 0 {
			break
		}
		if before == math.MaxInt64 {
			lastSeq = rows[0].SequenceID
		}
		before = rows[len(rows)-1].SequenceID
		for _, row := range rows {
			if row.ExcludedFromContext {
				continue
			}
			user, text, _, err := liveDialogue(row)
			if err != nil {
				return nil, 0, err
			}
			if text == "" {
				continue
			}
			role, contentType := "assistant", "output_text"
			if user {
				role, contentType = "user", "input_text"
			}
			items = append(items, liveHistoryItem{Type: "message", Role: role, Content: []liveHistoryText{{Type: contentType, Text: truncateRunes(text, liveContextItemRunes)}}})
			if len(items) == liveContextMessages {
				break
			}
		}
	}
	slices.Reverse(items)
	return items, lastSeq, nil
}

func truncateRunes(s string, limit int) string {
	r := []rune(s)
	if len(r) <= limit {
		return s
	}
	return string(r[:limit]) + "…"
}

// liveSituation is the bounded current state line for Live's instructions.
func (s *Server) liveSituation(conversation *generated.Conversation) string {
	state := "idle"
	if conversation.AgentWorking {
		state = "working"
	}
	situation := "Backend state: " + state + "."
	if cwd := derefString(conversation.Cwd); cwd != "" {
		situation += " Working directory: " + truncateRunes(cwd, 300) + "."
	}
	model := derefString(conversation.Model)
	if model == "" {
		model = s.effectiveDefaultModel(s.getModelList())
	}
	return situation + " Backend model: " + truncateRunes(model, 100) + "."
}
