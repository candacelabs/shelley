package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"shelley.exe.dev/db"
	"shelley.exe.dev/llm"
)

type liveMessageEnv struct {
	t        *testing.T
	s        *Server
	database *db.DB
	held     *heldLLMService
	ts       *httptest.Server
}

// newLiveMessageEnv is a Shelley whose model holds each turn until released.
func newLiveMessageEnv(t *testing.T) *liveMessageEnv {
	t.Helper()
	s, database, _ := newTestServer(t)
	held := newHeldLLMService()
	s.llmManager = &testLLMManager{service: held}
	mux := http.NewServeMux()
	s.RegisterRoutes(mux)
	ts := httptest.NewServer(s.tcpHandler(mux))
	t.Cleanup(func() {
		stopActiveConversationLoops(s)
		ts.Close()
	})
	return &liveMessageEnv{t: t, s: s, database: database, held: held, ts: ts}
}

func (e *liveMessageEnv) post(path, body string) (int, string) {
	e.t.Helper()
	req, err := http.NewRequest(http.MethodPost, e.ts.URL+path, strings.NewReader(body))
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("X-ExeDev-Email", "voice@example.com")
	resp, err := e.ts.Client().Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, strings.TrimSpace(string(b))
}

// delegate sends speech to the conversation and returns the turn it started,
// once the model has it, and the visible message.
func (e *liveMessageEnv) delegate(id, body string) (*heldLLMCall, string) {
	e.t.Helper()
	code, receipt := e.post("/api/conversation/"+id+"/live-message", body)
	var chat struct{ Status, Message string }
	if err := json.Unmarshal([]byte(receipt), &chat); err != nil || code != http.StatusAccepted || chat.Status != "accepted" {
		e.t.Fatalf("delegation: %d %s", code, receipt)
	}
	rows, err := e.database.ListMessagesByType(e.t.Context(), id, db.MessageTypeUser)
	if err != nil || len(rows) == 0 {
		e.t.Fatalf("no visible user message: %v", err)
	}
	var message llm.Message
	if err := json.Unmarshal([]byte(*rows[len(rows)-1].LlmData), &message); err != nil {
		e.t.Fatal(err)
	}
	if message.Content[0].Text != chat.Message || rows[len(rows)-1].UserData == nil {
		e.t.Fatalf("stored message %q differs from receipt %q", message.Content[0].Text, chat.Message)
	}
	if _, err := uuid.Parse(liveDeliveryIDFromUserData([]byte(*rows[len(rows)-1].UserData))); err != nil {
		e.t.Fatalf("stored message lacks a delivery UUID: %v", err)
	}
	return e.held.waitCall(e.t, chat.Message), chat.Message
}

func (e *liveMessageEnv) finish(id string, call *heldLLMCall) {
	e.t.Helper()
	e.s.mu.Lock()
	manager := e.s.activeConversations[id]
	e.s.mu.Unlock()
	idle := manager.idle()
	call.Release()
	<-idle
}

// The main assistant gets the spoken request as spoken, with its voice
// exchange visible, and its full history.
func TestLiveMessageDeliversSpeech(t *testing.T) {
	e := newLiveMessageEnv(t)
	slug := "voice-test"
	conv, err := e.database.CreateConversation(t.Context(), &slug, true, nil, nil, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.database.CreateMessage(t.Context(), db.CreateMessageParams{ConversationID: conv.ConversationID, Type: db.MessageTypeUser, LLMData: llm.Message{Role: llm.MessageRoleUser, Content: []llm.Content{llm.StringContent("The typo is in live_message.go.")}}}); err != nil {
		t.Fatal(err)
	}
	call, message := e.delegate(conv.ConversationID, `{"transcript":"  Why is this so slow still\n","voice_context":"USER: Hello\nLIVE: Hey there!"}`)
	if message != "Spoken request:\nWhy is this so slow still"+liveVoiceExchangeUnnumbered+"USER: Hello\nLIVE: Hey there!" {
		t.Fatalf("message = %q", message)
	}
	if raw, _ := json.Marshal(call.request.Messages); !strings.Contains(string(raw), "The typo is in live_message.go.") {
		t.Errorf("main assistant lacks history: %s", raw)
	}
	e.finish(conv.ConversationID, call)
	if code, body := e.post("/api/conversation/"+conv.ConversationID+"/live-message", `{"transcript":" "}`); code != http.StatusBadRequest {
		t.Errorf("empty transcript: %d %s", code, body)
	}
}

// Spoken slash commands are text for the assistant, not runtime controls.
func TestLiveMessageSpeechIsNotACommand(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "executed")
	writeSlashHook(t, "someuserhook", "#!/bin/sh\nprintf x > '"+marker+"'\necho replaced\n")
	e := newLiveMessageEnv(t)
	slug := "voice-test"
	conv, err := e.database.CreateConversation(t.Context(), &slug, true, nil, nil, db.ConversationOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for _, speech := range []string{"/model unavailable", "/someuserhook do it", "/compact"} {
		call, message := e.delegate(conv.ConversationID, `{"transcript":"`+speech+`"}`)
		if message != "Spoken request:\n"+speech {
			t.Errorf("message = %q", message)
		}
		e.finish(conv.ConversationID, call)
	}
	if row, err := e.database.GetConversationByID(t.Context(), conv.ConversationID); err != nil || derefString(row.Model) != "predictable" {
		t.Errorf("speech changed the model: %+v", row)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Errorf("spoken slash hook executed: %v", err)
	}
}

// A blank draft's first delegation starts the conversation as its first typed
// send would, with the selected profile's settings; a conversation under way
// keeps its own.
func TestLiveMessageDraftFirstSend(t *testing.T) {
	e := newLiveMessageEnv(t)
	if code, body := e.post("/api/profiles", `{"name":"Personal","model":"predictable","system_prompt":"Be a helpful personal assistant.","tool_overrides":{"bash":"off"}}`); code != http.StatusCreated {
		t.Fatal(code, body)
	}
	draft, err := e.database.CreateDraftConversation(t.Context(), nil, nil, db.ConversationOptions{}, "")
	if err != nil {
		t.Fatal(err)
	}
	// Preset the slug so the first send does not also ask the model to name it.
	if _, err := e.database.UpdateConversationSlug(t.Context(), draft.ConversationID, "voice-draft"); err != nil {
		t.Fatal(err)
	}
	cwd := t.TempDir()
	if code, body := e.post("/api/conversation/"+draft.ConversationID+"/live-message", `{"transcript":"inspect","conversation_options":{"profile":"Nope"}}`); code != http.StatusBadRequest || !strings.Contains(body, "Nope") {
		t.Fatalf("unknown profile: %d %s", code, body)
	}
	call, _ := e.delegate(draft.ConversationID, `{"transcript":"inspect the project","cwd":"`+cwd+`","conversation_options":{"profile":"Personal","thinking_level":"high"}}`)
	if !strings.Contains(systemText(call.request), "Be a helpful personal assistant.") {
		t.Error("main backend lost the profile's system prompt")
	}
	e.finish(draft.ConversationID, call)
	row, err := e.database.GetConversationByID(t.Context(), draft.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	options := db.ParseConversationOptions(row.ConversationOptions)
	if row.IsDraft || derefString(row.Cwd) != cwd || derefString(row.Model) != "predictable" || options.Profile != "Personal" || options.ToolOverrides["bash"] != "off" || options.ThinkingLevel != "high" {
		t.Fatalf("first send settings: %+v options=%+v", row, options)
	}

	call, _ = e.delegate(draft.ConversationID, `{"transcript":"keep going","model":"unavailable","cwd":"/tmp/unrelated","conversation_options":{"profile":"Nope"}}`)
	e.finish(draft.ConversationID, call)
	if again, err := e.database.GetConversationByID(t.Context(), draft.ConversationID); err != nil || again.ConversationOptions != row.ConversationOptions || derefString(again.Cwd) != cwd {
		t.Errorf("a later delegation changed settings: %+v", again)
	}
}
