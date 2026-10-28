package generated

import (
	"database/sql"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestSubagentUsageQueriesSearchMessagesByConversation(t *testing.T) {
	t.Parallel()
	database, err := sql.Open("sqlite", "file:"+t.TempDir()+"/query-plan.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })

	for _, statement := range []string{
		`CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY, parent_conversation_id TEXT)`,
		`CREATE INDEX idx_conversations_parent_id ON conversations(parent_conversation_id)`,
		`CREATE TABLE messages (conversation_id TEXT, sequence_id INTEGER, type TEXT, usage_data TEXT, other_usage_data TEXT, model_name TEXT, llm_api_url TEXT)`,
		`CREATE INDEX idx_messages_conversation_id ON messages(conversation_id)`,
		`CREATE INDEX idx_messages_type ON messages(type)`,
		`CREATE INDEX idx_messages_conv_type_seq ON messages(conversation_id, type, sequence_id)`,
	} {
		if _, err := database.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}

	tests := []struct {
		name  string
		query string
		want  string
	}{
		{"direct usage", getSubagentUsage, "SEARCH m USING INDEX idx_messages_conv_type_seq (conversation_id=? AND type=?)"},
		{"indirect usage", getSubagentOtherUsage, "SEARCH m USING INDEX idx_messages_conversation_id (conversation_id=?)"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rows, err := database.Query("EXPLAIN QUERY PLAN "+test.query, "parent")
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()

			var plan []string
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				plan = append(plan, detail)
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			joined := strings.Join(plan, "\n")
			if !strings.Contains(joined, test.want) {
				t.Fatalf("query plan does not search messages by conversation:\n%s", joined)
			}
		})
	}
}

func TestSearchSnippetsScanFTSBeforeRankedMessages(t *testing.T) {
	t.Parallel()
	database, err := sql.Open("sqlite", "file:"+t.TempDir()+"/snippet-plan.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	for _, statement := range []string{
		`CREATE TABLE messages (message_id TEXT PRIMARY KEY, conversation_id TEXT)`,
		`CREATE VIRTUAL TABLE messages_fts USING fts5(text)`,
	} {
		if _, err := database.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	query := strings.Replace(searchConversationsFTSSnippets, "/*SLICE:conv_ids*/?", "?,?", 1)
	rows, err := database.Query("EXPLAIN QUERY PLAN "+query, "[", "]", `"sub"*`, "first", "second")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	var plan []string
	ftsLoop, rankedLoop := -1, -1
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(detail, "SCAN messages_fts VIRTUAL TABLE") {
			ftsLoop = len(plan)
		}
		if detail == "SCAN ranked" || strings.HasPrefix(detail, "SEARCH ranked ") {
			rankedLoop = len(plan)
		}
		plan = append(plan, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if ftsLoop < 0 || rankedLoop < ftsLoop {
		t.Fatalf("FTS must scan outside the ranked-message loop:\n%s", strings.Join(plan, "\n"))
	}
}
