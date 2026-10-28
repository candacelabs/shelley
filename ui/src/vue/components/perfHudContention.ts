// The perf HUD's model of IndexedDB lock contention. deadline.ts keeps the
// evidence (waits in flight, waits given up on — see MissedDeadline for why
// that matters); this module reduces it to one question for the HUD, should
// there be an alert, plus the rows to show when the user clicks it.
import type { MissedDeadline, PendingWait } from "../../services/deadline";
import { isIndexedDBWait } from "../../services/deadline";

export interface IdbContention {
  /** Show the alert button. */
  alert: boolean;
  /** Missed IDB deadlines, newest first. */
  rows: MissedDeadline[];
  /** IDB waits still in flight and already past half their budget. */
  inFlight: PendingWait[];
}

/**
 * An in-flight wait becomes worth showing once it has used this share of its
 * budget: sooner and the HUD flickers on every healthy 5ms open, later and a
 * stuck tab shows nothing until it has actually given up.
 */
const IN_FLIGHT_ALERT_FRACTION = 0.5;

/**
 * Below this, "stalled" time is timer jitter and busy-but-healthy turns, not
 * a blocked tab worth pointing out.
 */
const STALL_NOTE_MS = 50;

export function summarizeIdbContention(
  missed: MissedDeadline[],
  pending: PendingWait[],
): IdbContention {
  const rows = missed.filter((m) => isIndexedDBWait(m.what)).reverse();
  const inFlight = pending.filter(
    // Budget used, not wall time: a wait that is only old because this tab
    // was blocked or throttled says nothing about IndexedDB.
    (w) => isIndexedDBWait(w.what) && w.chargedMs >= w.deadlineMs * IN_FLIGHT_ALERT_FRACTION,
  );
  return {
    alert: rows.length > 0 || inFlight.length > 0,
    rows,
    inFlight,
  };
}

/** "295ms", "1.84s", "12.3s" — shared with the HUD's other tables. */
export function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
  return `${Math.round(ms)}ms`;
}

/** One phrase for the details table: what became of the abandoned wait. */
export function describeStallOutcome(m: MissedDeadline): string {
  const after = m.settledAfterMs !== undefined ? ` after ${formatDuration(m.settledAfterMs)}` : "";
  switch (m.outcome) {
    case "pending":
      return "no answer yet";
    case "completed":
      return `completed${after}`;
    case "abandoned":
      return `abandoned${after}`;
    case "failed":
      return `failed${after}: ${m.error ?? "unknown error"}`;
  }
}

/**
 * Time a wait spent with this tab blocked or throttled (not charged to its
 * deadline), or "" when too small to mention. A miss with a large stall means
 * the tab was busy as well as the cache being slow.
 */
export function describeStall(stalledMs: number): string {
  return stalledMs >= STALL_NOTE_MS ? `tab blocked ${formatDuration(stalledMs)}` : "";
}
