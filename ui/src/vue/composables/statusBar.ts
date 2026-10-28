import { onScopeDispose, ref, watch, type WatchSource } from "vue";
import { api, type StatusBar } from "../../services/api";

// How long coming back to a tab waits for its other event.
export const RETURN_DEBOUNCE_MS = 100;

// The status-bar hook's output for the open conversation. The server runs the
// hook when asked, so asking only while someone is looking is what keeps it
// from running for nobody: when the conversation opens, whenever a trigger
// changes (a new message, say), and when the tab comes back into view or the
// window regains focus, since the branch may have changed meanwhile. A hidden
// tab doesn't ask. One request at a time; changes during one collapse into a
// single request after it. A null id shows nothing; while ready() is false
// (the conversation is loading) it waits.
//
// On a switch, `status` stays the old conversation's, `stale`, until the new
// one's comes: the row keeps its place, blank, rather than going and coming
// back, which would shift the messages twice.
export function useStatusBar(
  conversationId: () => string | null,
  ready: () => boolean,
  triggers: WatchSource[],
) {
  const status = ref<StatusBar | null>(null);
  const stale = ref(false);
  let busy = false;
  let wanted = false;
  let disposed = false;
  // Aborting the request also kills the hook, so a slow one doesn't hold up
  // the next conversation's.
  let inFlight: AbortController | undefined;

  async function refresh() {
    wanted = true;
    if (busy) return;
    busy = true;
    try {
      while (wanted && !disposed && document.visibilityState !== "hidden") {
        wanted = false;
        const id = conversationId();
        if (!id || !ready()) continue;
        const request = (inFlight = new AbortController());
        try {
          const next = await api.getStatusBar(id, request.signal);
          if (id === conversationId()) {
            status.value = next;
            stale.value = false;
          }
        } catch (err) {
          if (request.signal.aborted) continue;
          console.warn("Failed to get status bar:", err);
          if (stale.value && id === conversationId()) {
            status.value = null;
            stale.value = false;
          }
        }
      }
    } finally {
      busy = false;
      inFlight = undefined;
    }
  }

  watch(
    [conversationId, ready, ...triggers],
    ([id, isReady], previous) => {
      if (id !== previous?.[0]) {
        inFlight?.abort();
        stale.value = !!id;
        if (!id) status.value = null;
      }
      if (isReady) void refresh();
    },
    // After the component's own watchers, which may mark the conversation
    // loading in the same tick.
    { immediate: true, flush: "post" },
  );

  // Coming back to a tab fires visibilitychange and focus in a row: one
  // refresh for both. It asks even with a request on its way, which may have
  // started before the user came back.
  let back: ReturnType<typeof setTimeout> | undefined;
  const onBack = () => {
    clearTimeout(back);
    back = setTimeout(() => void refresh(), RETURN_DEBOUNCE_MS);
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") onBack();
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onBack);
  onScopeDispose(() => {
    disposed = true;
    inFlight?.abort();
    clearTimeout(back);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onBack);
  });

  return { status, stale };
}
