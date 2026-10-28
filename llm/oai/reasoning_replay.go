package oai

import (
	"strings"

	"github.com/sashabaranov/go-openai"
	"shelley.exe.dev/models/modelsdev"
)

// ReasoningReplay controls whether and how prior assistant reasoning is sent
// back to OpenAI-compatible APIs during tool loops.
type ReasoningReplay string

const (
	ReasoningReplayAuto    ReasoningReplay = "auto"
	ReasoningReplayNone    ReasoningReplay = "none"
	ReasoningReplayContent ReasoningReplay = "reasoning_content"
)

// ResolveReasoningReplay resolves auto from models.dev while preserving
// explicit none. The zero value is auto for service configuration.
func ResolveReasoningReplay(endpoint, modelName string, configured ReasoningReplay) ReasoningReplay {
	switch configured {
	case "", ReasoningReplayAuto:
		field, found := modelsdev.LookupInterleavedReasoningField(endpoint, modelName)
		if field == string(ReasoningReplayContent) {
			return ReasoningReplayContent
		}
		if found {
			return ReasoningReplayNone
		}
		return ""
	case ReasoningReplayNone, ReasoningReplayContent:
		return configured
	default:
		return ReasoningReplayNone
	}
}

// reasoningPolicy applies only to the outgoing copy, after origin filtering.
//
// Route          Real reasoning                 Missing tool reasoning
// Fireworks      Follow the replay setting      Omit, including stored blanks
// DeepSeek       Replay unknown models in auto  Empty string, even with replay disabled
// Other          Follow the replay setting      Empty string when replay is enabled
type reasoningPolicy struct {
	replay           bool
	omitBlank        bool
	requireToolField bool
}

func resolveReasoningPolicy(provider, endpoint, model string, configured ReasoningReplay) reasoningPolicy {
	mode := ResolveReasoningReplay(endpoint, model, configured)
	deepSeek := isDeepSeekBaseURL(endpoint)
	replay := mode == ReasoningReplayContent || deepSeek && mode == ""
	return reasoningPolicy{
		replay:           replay,
		omitBlank:        isFireworks(provider, endpoint, model),
		requireToolField: replay || deepSeek,
	}
}

func (p reasoningPolicy) content(m openai.ChatCompletionMessage) *string {
	if !p.replay {
		m.ReasoningContent = ""
	}
	if m.Role == "assistant" {
		if p.omitBlank && strings.TrimSpace(m.ReasoningContent) == "" {
			return nil
		}
		if p.requireToolField && len(m.ToolCalls) > 0 {
			return &m.ReasoningContent
		}
	}
	if m.ReasoningContent == "" {
		return nil
	}
	return &m.ReasoningContent
}

func isDeepSeekBaseURL(endpoint string) bool {
	return endpointHostMatches(endpoint, "deepseek.com")
}

// Fireworks routes may use a gateway URL or a custom OpenAI-compatible service.
func isFireworks(provider, endpoint, model string) bool {
	return provider == "fireworks" || endpointHostMatches(endpoint, "fireworks.ai") ||
		strings.HasPrefix(model, "accounts/fireworks/models/") ||
		strings.HasPrefix(model, "fireworks/")
}
