package server

import (
	"context"
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
)

// cacheGetResult is one fileListCache.get outcome, delivered on a channel so a
// test can observe whether a caller has returned yet.
type cacheGetResult struct {
	files     []string
	truncated bool
	err       error
}

func goCacheGet(ctx context.Context, c *fileListCache, key string, load func(context.Context) ([]string, bool, error)) <-chan cacheGetResult {
	ch := make(chan cacheGetResult, 1)
	go func() {
		files, truncated, err := c.get(ctx, key, load)
		ch <- cacheGetResult{files, truncated, err}
	}()
	return ch
}

func requireNotReturned(t *testing.T, ch <-chan cacheGetResult, who string) {
	t.Helper()
	select {
	case r := <-ch:
		t.Fatalf("%s returned early: %+v", who, r)
	default:
	}
}

// TestFileListCacheCoalescesConcurrentLoads verifies that concurrent cold
// misses for one key share a single listing. Without coalescing, a burst of
// requests (keystrokes, or TestFindFilesConcurrentModes) forks one `git
// ls-files` + `git check-ignore` pair per request instead of one in total.
func TestFileListCacheCoalescesConcurrentLoads(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		c := newFileListCache()
		var calls atomic.Int32
		gate := make(chan struct{})
		release := sync.OnceFunc(func() { close(gate) })
		defer release() // unblock loads even when an assertion fails early
		load := func(context.Context) ([]string, bool, error) {
			calls.Add(1)
			<-gate
			return []string{"a.go", "b.go"}, true, nil
		}

		const n = 24
		var wg sync.WaitGroup
		results := make([]cacheGetResult, n)
		for i := range n {
			wg.Go(func() {
				files, truncated, err := c.get(t.Context(), "/repo", load)
				results[i] = cacheGetResult{files, truncated, err}
			})
		}
		synctest.Wait()
		inFlight := calls.Load()
		release()
		wg.Wait()

		if inFlight != 1 {
			t.Errorf("%d concurrent cold misses ran %d loads, want 1", n, inFlight)
		}
		for i, r := range results {
			if r.err != nil || !r.truncated || !slices.Equal(r.files, []string{"a.go", "b.go"}) {
				t.Errorf("caller %d: %+v, want the shared truncated listing", i, r)
			}
		}
		if got := calls.Load(); got != 1 {
			t.Errorf("loads after release = %d, want 1", got)
		}
	})
}

// TestFileListCacheUnrelatedKeyNotBlocked verifies a slow load for one key
// doesn't hold up a load for another: coalescing is per key, not a global lock.
func TestFileListCacheUnrelatedKeyNotBlocked(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		c := newFileListCache()
		gate := make(chan struct{})
		release := sync.OnceFunc(func() { close(gate) })
		defer release() // unblock loads even when an assertion fails early
		slow := goCacheGet(t.Context(), c, "/slow", func(context.Context) ([]string, bool, error) {
			<-gate
			return []string{"slow.go"}, false, nil
		})
		synctest.Wait()

		fast := goCacheGet(t.Context(), c, "/fast", func(context.Context) ([]string, bool, error) {
			return []string{"fast.go"}, false, nil
		})
		synctest.Wait()
		select {
		case r := <-fast:
			if r.err != nil || !slices.Equal(r.files, []string{"fast.go"}) {
				t.Errorf("unrelated key: %+v", r)
			}
		default:
			t.Error("unrelated key is blocked behind the slow key's load")
		}
		requireNotReturned(t, slow, "slow-key caller")

		release()
		if r := <-slow; r.err != nil || !slices.Equal(r.files, []string{"slow.go"}) {
			t.Fatalf("slow key: %+v", r)
		}
	})
}

// Canceling the initiating request must not cancel a load that still has waiters.
func TestFileListCacheLeaderCancelDoesNotFailFollowers(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		c := newFileListCache()
		var calls atomic.Int32
		gate := make(chan struct{})
		release := sync.OnceFunc(func() { close(gate) })
		defer release()
		load := func(ctx context.Context) ([]string, bool, error) {
			calls.Add(1)
			select {
			case <-gate:
				return []string{"a.go"}, false, nil
			case <-ctx.Done():
				return nil, false, ctx.Err()
			}
		}

		leaderCtx, cancelLeader := context.WithCancel(t.Context())
		defer cancelLeader()
		leader := goCacheGet(leaderCtx, c, "/repo", load)
		synctest.Wait()
		followers := []<-chan cacheGetResult{
			goCacheGet(t.Context(), c, "/repo", load),
			goCacheGet(t.Context(), c, "/repo", load),
		}
		synctest.Wait()
		for _, f := range followers {
			requireNotReturned(t, f, "follower")
		}

		cancelLeader()
		if r := <-leader; !errors.Is(r.err, context.Canceled) {
			t.Fatalf("leader: %+v, want context.Canceled", r)
		}
		synctest.Wait()
		if got := calls.Load(); got != 1 {
			t.Errorf("loads after initiating request canceled = %d, want 1", got)
		}
		release()
		for i, f := range followers {
			if r := <-f; r.err != nil || !slices.Equal(r.files, []string{"a.go"}) {
				t.Errorf("follower %d: %+v, want the shared listing", i, r)
			}
		}
		if got := calls.Load(); got != 1 {
			t.Errorf("loads = %d, want 1", got)
		}
		if e, ok := c.entries["/repo"]; !ok || !slices.Equal(e.files, []string{"a.go"}) {
			t.Errorf("cache entry = %+v, %v", e, ok)
		}
	})
}

// TestFileListCacheWaiterCancel verifies a caller waiting on someone else's
// load returns as soon as its own context ends, and that its departure
// neither cancels nor poisons the load it was waiting on.
func TestFileListCacheWaiterCancel(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		c := newFileListCache()
		var calls atomic.Int32
		gate := make(chan struct{})
		release := sync.OnceFunc(func() { close(gate) })
		defer release() // unblock loads even when an assertion fails early
		load := func(context.Context) ([]string, bool, error) {
			calls.Add(1)
			<-gate
			return []string{"a.go"}, false, nil
		}

		leader := goCacheGet(t.Context(), c, "/repo", load)
		synctest.Wait()
		waiterCtx, cancelWaiter := context.WithCancel(t.Context())
		defer cancelWaiter()
		waiter := goCacheGet(waiterCtx, c, "/repo", load)
		synctest.Wait()
		requireNotReturned(t, waiter, "waiter")

		cancelWaiter()
		synctest.Wait()
		select {
		case r := <-waiter:
			if !errors.Is(r.err, context.Canceled) || r.files != nil {
				t.Errorf("cancelled waiter: %+v, want context.Canceled and no files", r)
			}
		default:
			t.Error("cancelled waiter is still blocked on the shared load")
		}
		requireNotReturned(t, leader, "leader")

		release()
		synctest.Wait() // let a still-blocked waiter drain before the bubble exits
		if r := <-leader; r.err != nil || !slices.Equal(r.files, []string{"a.go"}) {
			t.Fatalf("leader: %+v", r)
		}
		if got := calls.Load(); got != 1 {
			t.Errorf("loads = %d, want 1", got)
		}
		if _, ok := c.entries["/repo"]; !ok {
			t.Error("leader's successful load was not cached")
		}
	})
}

// TestFileListCacheSharedFailureNotCached verifies a real listing failure is
// reported to every caller that shared the load, is not retried by them, and
// is not cached: the next request lists afresh. That includes the listing's
// own internal budget (git commands run under findFilesWalkBudget) expiring
// while the leader's request is still live: DeadlineExceeded from inside load
// is an ordinary failure, not a leader cancellation to hand over.
func TestFileListCacheSharedFailureNotCached(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name string
		err  error
	}{
		{"load error", errors.New("listing failed")},
		{"internal budget expired", context.DeadlineExceeded},
		{"load canceled with live flight", context.Canceled},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			synctest.Test(t, func(t *testing.T) {
				c := newFileListCache()
				var calls atomic.Int32
				gate := make(chan struct{})
				release := sync.OnceFunc(func() { close(gate) })
				defer release() // unblock loads even when an assertion fails early
				failing := func(context.Context) ([]string, bool, error) {
					calls.Add(1)
					<-gate
					return nil, false, tc.err
				}

				callers := make([]<-chan cacheGetResult, 4)
				callers[0] = goCacheGet(t.Context(), c, "/repo", failing)
				synctest.Wait() // callers[0] owns the load
				for i := 1; i < len(callers); i++ {
					callers[i] = goCacheGet(t.Context(), c, "/repo", failing)
				}
				synctest.Wait()
				release()
				for i, ch := range callers {
					if r := <-ch; !errors.Is(r.err, tc.err) || r.files != nil {
						t.Errorf("caller %d: %+v, want the shared error %v", i, r, tc.err)
					}
				}
				if got := calls.Load(); got != 1 {
					t.Errorf("loads = %d, want 1 (no retry of a live leader's failure)", got)
				}
				if _, ok := c.entries["/repo"]; ok {
					t.Fatal("failed load was cached")
				}

				files, _, err := c.get(t.Context(), "/repo", func(context.Context) ([]string, bool, error) {
					return []string{"a.go"}, false, nil
				})
				if err != nil || !slices.Equal(files, []string{"a.go"}) {
					t.Fatalf("request after failure: files=%v err=%v", files, err)
				}
			})
		})
	}
}

// A live request can arrive after the last waiter canceled the flight but
// before the loader finished cleaning up. It must get a fresh load, not
// inherit the canceled flight's error.
func TestFileListCacheLateJoinCanceledFlight(t *testing.T) {
	t.Parallel()
	synctest.Test(t, func(t *testing.T) {
		c := newFileListCache()
		gate := make(chan struct{})
		release := sync.OnceFunc(func() { close(gate) })
		defer release()
		var calls atomic.Int32
		load := func(ctx context.Context) ([]string, bool, error) {
			if calls.Add(1) == 1 {
				<-ctx.Done()
				<-gate
				return []string{"partial.go"}, true, nil
			}
			return []string{"a.go"}, false, nil
		}

		firstCtx, cancelFirst := context.WithCancel(t.Context())
		defer cancelFirst()
		first := goCacheGet(firstCtx, c, "/repo", load)
		synctest.Wait()
		cancelFirst()
		synctest.Wait()
		select {
		case r := <-first:
			if !errors.Is(r.err, context.Canceled) {
				t.Errorf("first request: %+v, want context.Canceled", r)
			}
		default:
			t.Error("canceled request is waiting for loader cleanup")
		}
		waiter := goCacheGet(t.Context(), c, "/repo", load)
		synctest.Wait()
		requireNotReturned(t, waiter, "waiter")

		release()
		if r := <-waiter; r.err != nil || r.truncated || !slices.Equal(r.files, []string{"a.go"}) {
			t.Errorf("live request: %+v, want the fresh listing", r)
		}
		if got := calls.Load(); got != 2 {
			t.Errorf("loads = %d, want canceled flight and fresh flight", got)
		}
	})
}
