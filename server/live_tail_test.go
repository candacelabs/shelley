package server

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"testing/synctest"
	"time"
)

func TestLiveTranscriptKeepsLateLiveForNextHandoff(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.say("Cap the panel", 0, 500)
		h.liveSays("Okay, I'll pass that along. And yeah, I'll have them make sure the live chat", 600, 3000)
		h.delegate("d1", 3000)
		h.advance(liveQuiet)
		h.liveSays(" panel doesn't get too tall.", 3000, 4000)
		h.say("Run tests", 5000, 5500)
		h.delegate("d2", 5500)
		h.advance(liveQuiet)
		expectEqual(t, "tasks", h.transcripts(), []string{"Cap the panel", "Run tests"})
		expectEqual(t, "ordinary handoffs", h.headings, []string{"Spoken request:", "Spoken request:"})
		if strings.Contains(h.deliveries[0].VoiceContext, "panel doesn't get too tall") {
			t.Fatalf("late Live text rewrote first handoff: %q", h.deliveries[0].VoiceContext)
		}
		if !strings.Contains(h.deliveries[1].VoiceContext, "LIVE: panel doesn't get too tall.\nUSER: Run tests") {
			t.Fatalf("late Live text missing from next handoff: %q", h.deliveries[1].VoiceContext)
		}
	})
}

func TestLiveTranscriptRetainsDeltasBeforeReceiptAndThroughHangup(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.set(func() { h.hold = make(chan struct{}) })
		h.say("Run tests", 0, 1000)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.liveSays("I'm handing that off.", 2000, 3000)
		h.say(" and lint", 1000, 1500)
		h.call.end("hung up before receipt")
		h.set(func() { close(h.hold) })
		synctest.Wait()
		expectEqual(t, "received late user words survive", h.transcripts(), []string{"Run tests", "and lint"})
		expectEqual(t, "continuation heading", h.headings, []string{"Spoken request:", "Spoken request (continued):"})
		expectEqual(t, "no successful handoff after hangup", h.instructions(), []string{"activity: true"})
	})
}

func TestLiveTranscriptContinuationConsumesOnlySparseUserOrdinals(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.set(func() { h.hold = make(chan struct{}) })
		h.say("Change the panel", 0, 500)
		h.liveSays("Handing it off", 1600, 2000)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.say(" and cap", 500, 1000)     // n=3, old request
		h.say("Run lint", 5000, 5500)    // n=4, next request
		h.say(" its height", 1000, 1500) // n=5, delayed old request
		h.set(func() { close(h.hold) })
		synctest.Wait()
		expectEqual(t, "continued speech", h.transcripts(), []string{"Change the panel", "and cap its height"})
		expectEqual(t, "continued heading", h.headings[1], "Spoken request (continued):")
		all, _, _ := h.call.instructions(0)
		var handoffs []struct {
			Type       string `json:"type"`
			Through    int    `json:"through"`
			DeliveryID string `json:"delivery_id"`
			Fragments  []int  `json:"fragments"`
		}
		for _, instruction := range all {
			var wire struct {
				Type       string `json:"type"`
				Through    int    `json:"through"`
				DeliveryID string `json:"delivery_id"`
				Fragments  []int  `json:"fragments"`
			}
			if err := json.Unmarshal(instruction.data, &wire); err != nil {
				t.Fatal(err)
			}
			if wire.Type == "handoff" {
				var fields map[string]json.RawMessage
				if err := json.Unmarshal(instruction.data, &fields); err != nil {
					t.Fatal(err)
				}
				if _, ok := fields["message"]; ok {
					t.Fatalf("handoff retained receipt text: %s", instruction.data)
				}
				handoffs = append(handoffs, wire)
			}
		}
		if len(handoffs) != 2 {
			t.Fatalf("handoffs = %+v", handoffs)
		}
		expectEqual(t, "original prefix unchanged", handoffs[0].Fragments, []int(nil))
		expectEqual(t, "sparse continuation", handoffs[1].Fragments, []int{3, 5})
		expectEqual(t, "continuation through", handoffs[1].Through, 5)
		expectEqual(t, "stable distinct delivery IDs", []string{handoffs[0].DeliveryID, handoffs[1].DeliveryID}, []string{"delivery-1", "delivery-2"})
		if strings.Contains(h.deliveries[1].VoiceContext, "Run lint") {
			t.Fatal("following utterance entered continuation context")
		}
		h.delegate("d2", 5500)
		h.advance(liveQuiet)
		expectEqual(t, "next utterance remains and no repeated late words", h.transcripts(), []string{"Change the panel", "and cap its height", "Run lint"})
	})
}

func TestLiveTranscriptNextDelegationCanClaimLateUserWords(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.say("Run tests", 0, 500)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.say(" and lint", 500, 1000)
		h.delegate("d2", 1800)
		h.advance(2 * liveQuiet)
		expectEqual(t, "no duplicate continuation", h.transcripts(), []string{"Run tests", "and lint"})
		expectEqual(t, "both ordinary delegations", h.headings, []string{"Spoken request:", "Spoken request:"})
	})
}

func TestLiveTranscriptUnusableNextDelegationDoesNotDropContinuation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.say("Run tests", 0, 500)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.say(" and lint", 500, 1000)
		// This later delegation cannot claim speech from so long ago.
		h.delegate("d2", 30_000)
		h.advance(liveDeadline)
		expectEqual(t, "late words still delivered", h.transcripts(), []string{"Run tests", "and lint"})
		expectEqual(t, "continuation, not unusable delegation", h.headings, []string{"Spoken request:", "Spoken request (continued):"})
	})
}

func TestLiveTranscriptContinuationKeepsEchoGuard(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.say("Run tests", 0, 500)
		h.liveSays("Shelley is working on that request now", 600, 2000)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.say("Shelley is working on that request", 700, 1900)
		h.advance(liveQuiet)
		expectEqual(t, "echo never becomes a task", h.transcripts(), []string{"Run tests"})
	})
}

func TestLiveTranscriptFailedOriginalRestoresPendingWords(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.set(func() {
			h.hold = make(chan struct{})
			h.reply = func(string) (liveReceipt, error) { return liveReceipt{}, errors.New("delivery failed") }
		})
		h.say("Run tests", 0, 500)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.liveSays("handing it off", 600, 2000)
		h.say(" and lint", 500, 1000)
		h.set(func() { close(h.hold) })
		synctest.Wait()
		expectEqual(t, "original user words restored", liveSpeech(h.call.unclaimedUser()), "Run tests and lint")
		h.set(func() {
			h.reply = func(string) (liveReceipt, error) { return liveReceipt{Status: "accepted"}, nil }
		})
		h.delegate("d2", 2000)
		h.advance(liveQuiet)
		expectEqual(t, "retry keeps all request words", h.transcripts(), []string{"Run tests", "Run tests and lint"})
	})
}

func TestLiveTranscriptHangupFlushesReceivedContinuationWithoutQuietWait(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.say("Run tests", 0, 500)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.say(" and lint", 500, 1000)
		h.call.end("hung up")
		synctest.Wait()
		expectEqual(t, "received continuation delivered immediately", h.transcripts(), []string{"Run tests", "and lint"})
		h.advance(time.Second)
		expectEqual(t, "only once", len(h.transcripts()), 2)
	})
}

func TestLiveTranscriptPunctuationTailIsIgnoredWithoutContinuation(t *testing.T) {
	for _, punctuation := range []string{".", "\n."} {
		for _, finish := range []string{"quiet", "hangup"} {
			t.Run(punctuation+"/"+finish, func(t *testing.T) {
				synctest.Test(t, func(t *testing.T) {
					h := newLiveHarness(t)
					h.say("Run tests", 0, 500)
					h.delegate("d1", 2000)
					h.advance(liveQuiet)
					h.say(punctuation, 500, 600)
					if finish == "quiet" {
						h.advance(liveQuiet)
					} else {
						h.call.end("hung up")
					}
					synctest.Wait()
					expectEqual(t, "no punctuation task", h.transcripts(), []string{"Run tests"})
					expectEqual(t, "no punctuation heading", h.headings, []string{"Spoken request:"})
					if !h.call.taken[2] {
						t.Fatal("punctuation was not consumed")
					}
				})
			})
		}
	}
}

func TestLiveTranscriptContinuationPreservesMeaningfulSymbols(t *testing.T) {
	for _, speech := range []string{"C++", "+", "🙂"} {
		t.Run(speech, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				h := newLiveHarness(t)
				h.say("Build it", 0, 500)
				h.delegate("d1", 2000)
				h.advance(liveQuiet)
				h.say(" "+speech, 500, 1000)
				h.advance(liveQuiet)
				expectEqual(t, "symbol-bearing continuation", h.transcripts(), []string{"Build it", speech})
			})
		})
	}
}

func TestLiveTranscriptHangupReleasesDroppedTaskReservations(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.set(func() { h.hold = make(chan struct{}) })
		h.say("Run tests", 0, 500)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.say(" and lint", 500, 1000)
		h.delegate("d2", 2500)
		h.advance(liveQuiet)
		h.call.end("hung up")
		h.set(func() { close(h.hold) })
		synctest.Wait()
		expectEqual(t, "successful tail drains after dropped queued task", h.transcripts(), []string{"Run tests", "and lint"})
		expectEqual(t, "dropped task never delivers", h.headings, []string{"Spoken request:", "Spoken request (continued):"})
	})
}

func TestLiveTranscriptUnusableDelegationConsumesStaleSpeech(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.say("Delete the old branch", 0, 1000)
		h.delegate("d1", 4000)
		h.advance(liveDeadline)
		h.liveSays("Sorry, could you repeat that?", 4100, 5000)
		h.say("Delete the old branch", 5800, 6800)
		h.delegate("d2", 6800)
		h.advance(liveQuiet)
		expectEqual(t, "retry excludes unusable delegation speech", h.transcripts(), []string{"Delete the old branch"})
	})
}

func TestLiveTranscriptUnusableDelegationPreservesPendingTail(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		h := newLiveHarness(t)
		h.set(func() { h.hold = make(chan struct{}) })
		h.say("Run tests", 0, 500)
		h.delegate("d1", 2000)
		h.advance(liveQuiet)
		h.say(" and lint", 500, 1000)
		h.delegate("unusable", 6000)
		h.advance(liveDeadline)
		h.set(func() { close(h.hold) })
		synctest.Wait()
		expectEqual(t, "pending tail survives rejected delegation", h.transcripts(), []string{"Run tests", "and lint"})
	})
}
