package server

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestBuildTranscriptionPrompt(t *testing.T) {
	prompt := buildTranscriptionPrompt("minikomi-faster-recording", "/home/exedev/shelley", "transcription-testing", nil)
	for _, expected := range []string{
		"dictating a request or instruction to Shelley",
		"Application: Shelley",
		"Platform: exe.dev",
		"VM: minikomi-faster-recording",
		"Project: shelley",
		"Working directory: /home/exedev/shelley",
		"Conversation: transcription-testing",
	} {
		if !strings.Contains(prompt, expected) {
			t.Errorf("prompt missing %q:\n%s", expected, prompt)
		}
	}
}

func TestBuildTranscriptionPromptClampsMetadata(t *testing.T) {
	prompt := buildTranscriptionPrompt(strings.Repeat("vm ", 200), "/home/exedev/"+strings.Repeat("project", 100), strings.Repeat("conversation", 100), nil)
	if got := utf8.RuneCountInString(prompt); got > 1400 {
		t.Fatalf("prompt runes = %d", got)
	}
}
