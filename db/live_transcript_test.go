package db

import (
	"testing"

	"shelley.exe.dev/db/generated"
	"shelley.exe.dev/llm"
)

func TestLiveTranscriptMetadataDoesNotInterfere(t *testing.T) {
	database := setupTestDB(t)
	defer database.Close()
	ctx := t.Context()
	conv, err := database.CreateConversation(ctx, stringPtr("live-metadata"), true, nil, nil, ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	request, err := database.CreateMessage(ctx, CreateMessageParams{
		ConversationID: conv.ConversationID, Type: MessageTypeUser,
		LLMData: llm.Message{Role: llm.MessageRoleUser, Content: []llm.Content{llm.StringContent("Original request")}},
	})
	if err != nil {
		t.Fatal(err)
	}
	appendMetadata := func() generated.Message {
		t.Helper()
		row, err := database.CreateMessage(ctx, CreateMessageParams{
			ConversationID: conv.ConversationID, Type: MessageTypeLiveTranscript,
			ExcludedFromContext: true,
			UserData:            map[string]any{"session_id": "call", "delivery_id": "delivery", "fragments": []any{}},
		})
		if err != nil {
			t.Fatal(err)
		}
		if row.LlmData != nil || !row.ExcludedFromContext || row.UserData == nil {
			t.Fatalf("metadata is not display-only: %+v", row)
		}
		return *row
	}
	appendMetadata()
	errRow, err := database.CreateMessage(ctx, CreateMessageParams{
		ConversationID: conv.ConversationID, Type: MessageTypeError,
	})
	if err != nil {
		t.Fatal(err)
	}
	appendMetadata()
	latest, err := database.GetLatestActionableMessage(ctx, conv.ConversationID)
	if err != nil || latest.MessageID != errRow.MessageID {
		t.Fatalf("latest actionable = %+v, %v; want error", latest, err)
	}
	contextRows, err := database.ListMessagesForContext(ctx, conv.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(contextRows) != 2 {
		t.Fatalf("context contains metadata: %+v", contextRows)
	}
	if err := database.Queries(ctx, func(q *generated.Queries) error {
		tail, err := q.ListMessagesTail(ctx, generated.ListMessagesTailParams{ConversationID: conv.ConversationID, Limit: 2})
		if err != nil {
			return err
		}
		if len(tail) != 4 || tail[0].MessageID != request.MessageID || tail[2].MessageID != errRow.MessageID {
			t.Errorf("visible tail window shrank: %+v", tail)
		}
		since, err := q.ListMessagesSince(ctx, generated.ListMessagesSinceParams{ConversationID: conv.ConversationID, SequenceID: request.SequenceID})
		if err != nil {
			return err
		}
		if len(since) != 3 {
			t.Fatalf("since stream lost metadata: %+v", since)
		}
		for i, row := range since {
			if row.SequenceID != request.SequenceID+int64(i)+1 {
				t.Errorf("sequence gap: %+v", since)
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	rows, err := database.ListMessages(ctx, conv.ConversationID)
	if err != nil || len(rows) != 4 || *rows[0].LlmData != *request.LlmData {
		t.Fatalf("original request changed or all-row read filtered metadata: %+v, %v", rows, err)
	}
	for range 2 {
		result, err := database.CreateWarningMessage(ctx, conv.ConversationID, "retrying", 3, "suppressing")
		if err != nil || result.Suppressed {
			t.Fatalf("early warning suppression: %+v, %v", result, err)
		}
	}
	appendMetadata()
	third, err := database.CreateWarningMessage(ctx, conv.ConversationID, "retrying", 3, "suppressing")
	if err != nil || third.Suppressed {
		t.Fatalf("third warning: %+v, %v", third, err)
	}
	fourth, err := database.CreateWarningMessage(ctx, conv.ConversationID, "retrying", 3, "suppressing")
	if err != nil || !fourth.Suppressed {
		t.Fatalf("metadata reset warning run: %+v, %v", fourth, err)
	}
}
