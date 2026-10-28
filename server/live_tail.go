package server

import (
	"strings"
	"time"
	"unicode"
)

type liveJob struct {
	run          func()
	keepAfterEnd bool // received user continuations survive hang-up
	tail         *liveTail
	release      []int // reservations to release if this unsent job is dropped
}

// A snapshot opens a tail before delivery starts, so later user deltas can be
// retained for a continuation. Only a successful receipt unlocks delivery.
type liveTail struct {
	id         string
	startMs    float64
	offsetMs   float64
	through    int
	deliveryID string
	delivered  bool
	failed     bool
	onset      *float64 // first subsequent user utterance, on the audio timeline
	user       []liveFragment
	settle     *time.Timer
	settleN    int
}

func (c *liveCall) enqueue(job liveJob) {
	c.jobs = append(c.jobs, job)
	select {
	case c.kick <- struct{}{}:
	default:
	}
}

// acceptTail runs under mu. User captions are assigned by audio timing, not
// arrival order.
func (c *liveCall) acceptTail(f liveFragment) {
	if !f.user {
		return
	}
	for _, t := range c.tails {
		if f.n > t.through && f.startMs >= t.offsetMs && (t.onset == nil || f.startMs < *t.onset) {
			onset := f.startMs
			t.onset = &onset
			c.flushContinuation(t)
		}
	}
	for i := len(c.tails) - 1; i >= 0; i-- {
		t := c.tails[i]
		if t.failed || f.n <= t.through {
			continue
		}
		if f.startMs >= t.offsetMs || (i > 0 && f.startMs < t.startMs) {
			continue
		}
		t.user = append(t.user, f)
		if t.settle != nil {
			t.settle.Stop()
		}
		t.settleN++
		n := t.settleN
		t.settle = time.AfterFunc(liveQuiet, func() {
			c.locked(func() {
				if t.settleN == n {
					c.flushContinuation(t)
				}
			})
		})
		return
	}
}

func (c *liveCall) flushContinuation(t *liveTail) {
	if t.failed || !t.delivered || len(c.pending) > 0 {
		return
	}
	var fragments []liveFragment
	var ordinals []int
	for _, f := range t.user {
		if !c.taken[f.n] {
			fragments = append(fragments, f)
			ordinals = append(ordinals, f.n)
		}
	}
	t.user = nil
	speech := liveSpeech(fragments)
	if strings.TrimFunc(speech, func(r rune) bool { return unicode.IsPunct(r) || unicode.IsSpace(r) }) == "" {
		for _, n := range ordinals {
			c.taken[n] = true
		}
		return
	}
	if liveEcho(speech, fragments[0].startMs, liveLatestReply(c.fragments)) {
		for _, n := range ordinals {
			c.taken[n] = true
		}
		return
	}
	for _, n := range ordinals {
		c.taken[n] = true
	}
	through := ordinals[len(ordinals)-1]
	voiceContext := liveVoiceContext(c.call, fragments, 0)
	deliveryID := c.newDeliveryID()
	c.enqueue(liveJob{keepAfterEnd: true, run: func() {
		c.deliverTask(t, "Spoken request (continued):", speech, voiceContext, through, ordinals, deliveryID, true)
	}})
	c.activity()
}
