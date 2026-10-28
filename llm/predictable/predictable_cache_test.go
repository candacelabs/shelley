package predictable

import (
	"context"
	"testing"

	"shelley.exe.dev/llm"
)

func TestCacheReportsTheGivenPromptTokens(t *testing.T) {
	ask := func(text string) (*llm.Response, error) {
		return NewService().Do(context.Background(), &llm.Request{
			Messages: []llm.Message{{
				Role:    llm.MessageRoleUser,
				Content: []llm.Content{{Type: llm.ContentTypeText, Text: text}},
			}},
		})
	}
	resp, err := ask("cache: 500 10500")
	if err != nil {
		t.Fatal(err)
	}
	u := resp.Usage
	if u.CacheReadInputTokens != 500 || u.CacheCreationInputTokens != 10500 || u.InputTokens != 0 {
		t.Errorf("usage = %+v, want 500 read, 10500 written, no other input", u)
	}
	if _, err := ask("cache: lots"); err == nil {
		t.Error("cache: lots succeeded, want an error")
	}
}
