package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"

	"github.com/google/uuid"
)

const maxLiveRequestBytes = 128 << 10

// liveVoiceExchange separates the spoken request from the voice exchange it
// came from in the visible message (see liveVoiceContext and liveDialogue);
// liveVoiceExchangeUnnumbered does for exchanges the client sent, which
// have no call.
const (
	liveVoiceExchange           = "\n\nCall #"
	liveVoiceExchangeUnnumbered = "\n\nVoice exchange (for context only):\n"
)

// liveSettings are a draft's composer selection, which its first message
// promotes it with; chat ignores them once the conversation is under way.
type liveSettings struct {
	Model               string          `json:"model,omitempty"`
	Cwd                 string          `json:"cwd,omitempty"`
	ConversationOptions json.RawMessage `json:"conversation_options,omitempty"`
}

// liveChat delivers speech delegated by Live through the ordinary chat
// endpoint as r, so the backend reads the raw request with its full
// conversation and a draft's first send is as from the composer. The
// recorder holds chat's response: its receipt, the status and the message
// as submitted.
func (s *Server) liveChat(r *http.Request, conversationID, heading, transcript, voiceContext, reference string, settings liveSettings, deliveryID string) *httptest.ResponseRecorder {
	// The speech and its verbatim exchange stay visible to both the user and
	// the backend. The prefix makes even a spoken slash command ordinary text.
	message := heading + "\n" + transcript
	message += voiceContext + reference
	body, err := json.Marshal(struct {
		Message string `json:"message"`
		liveSettings
	}{message, settings})
	if err != nil {
		panic(err) // strings and a valid RawMessage
	}
	chatReq := r.Clone(contextWithTurnUserData(r.Context(), liveDeliveryUserData{DeliveryID: deliveryID}))
	chatReq.Body, chatReq.ContentLength = io.NopCloser(bytes.NewReader(body)), int64(len(body))
	chatReq.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	s.handleChatConversation(recorder, chatReq, conversationID)
	s.logger.Info("Live delegation submitted", "conversationID", conversationID, "status", recorder.Code)
	return recorder
}

// handleLiveMessage submits one delegation a client decided on itself, for
// clients that predate the call API (see live_call_http.go).
func (s *Server) handleLiveMessage(w http.ResponseWriter, r *http.Request, conversationID string) {
	var req struct {
		Transcript   string `json:"transcript"`
		VoiceContext string `json:"voice_context"`
		liveSettings
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxLiveRequestBytes)).Decode(&req); err != nil {
		http.Error(w, "Invalid live message", http.StatusBadRequest)
		return
	}
	req.Transcript = strings.TrimSpace(req.Transcript)
	if req.Transcript == "" {
		http.Error(w, "transcript is required", http.StatusBadRequest)
		return
	}
	voiceContext := ""
	if strings.TrimSpace(req.VoiceContext) != "" {
		voiceContext = liveVoiceExchangeUnnumbered + req.VoiceContext
	}
	recorder := s.liveChat(r, conversationID, "Spoken request:", req.Transcript, voiceContext, "", req.liveSettings, uuid.NewString())
	for k, v := range recorder.Header() {
		w.Header()[k] = v
	}
	w.WriteHeader(recorder.Code)
	w.Write(recorder.Body.Bytes())
}
