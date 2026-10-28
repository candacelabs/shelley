// Unit tests for the perf HUD's IndexedDB-contention alert model.
// Run with: tsx src/vue/components/perfHudContention.test.ts
import { summarizeIdbContention, describeStallOutcome, describeStall } from "./perfHudContention";
import type { MissedDeadline, PendingWait } from "../../services/deadline";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) passed++;
  else failures.push(`✗ ${name}${detail !== undefined ? `\n   ${JSON.stringify(detail)}` : ""}`);
}

const now = 1_000_000;
let nextId = 1;
const miss = (
  what: string,
  agoMs: number,
  extra: Partial<Omit<MissedDeadline, "id">> = {},
): MissedDeadline => ({
  id: nextId++,
  what,
  deadlineMs: 250,
  at: now - agoMs,
  outcome: "pending",
  stalledMs: 0,
  ...extra,
});
const wait = (
  id: number,
  what: string,
  deadlineMs: number,
  chargedMs: number,
  stalledMs = 0,
): PendingWait => ({
  id,
  what,
  deadlineMs,
  chargedMs,
  stalledMs,
  elapsedMs: chargedMs + stalledMs,
});

// Nothing missed, nothing waiting: no alert.
{
  const s = summarizeIdbContention([], []);
  check("quiet cache raises no alert", !s.alert && s.rows.length === 0, s);
}

// A stalled cache-key fetch is a problem, but not THIS problem.
{
  const s = summarizeIdbContention([miss("GET /api/cache-key", 100)], []);
  check("non-IDB misses do not raise the IDB alert", !s.alert && s.rows.length === 0, s);
}

// One missed IDB read is enough to alert; count and age are reported.
{
  const s = summarizeIdbContention(
    [miss("indexedDB.read conversation_meta", 3_000), miss("GET /api/cache-key", 10)],
    [],
  );
  check("an IDB miss alerts", s.alert, s);
  check("only IDB misses are counted", s.rows.length === 1, s);
  check("one row per IDB miss", s.rows.length === 1 && s.rows[0].what.includes("read"), s.rows);
}

// Newest first, and a wait still in flight past its deadline is shown live.
{
  const pending: PendingWait[] = [
    wait(101, "indexedDB.startup transaction", 3000, 2100),
    wait(102, "indexedDB.open", 5000, 5),
    wait(103, "navigator.locks shelley-cache-key", 3000, 2900),
  ];
  const s = summarizeIdbContention(
    [miss("indexedDB.open", 60_000), miss("indexedDB.read conversation_meta", 500)],
    pending,
  );
  check(
    "rows are newest first",
    s.rows[0].what.includes("read") && s.rows[1].what === "indexedDB.open",
    s.rows,
  );
  check(
    "a long in-flight IDB wait is shown ahead of history",
    s.inFlight.length === 1 && s.inFlight[0].what === "indexedDB.startup transaction",
    s.inFlight,
  );
  check(
    "a fresh in-flight wait is not yet a stall",
    !s.inFlight.some((w) => w.what === "indexedDB.open"),
  );
  check(
    "in-flight non-IDB waits are excluded",
    !s.inFlight.some((w) => w.what.startsWith("navigator")),
  );
  check("in-flight alone does not count as missed", s.rows.length === 2, s);
}

// A long in-flight wait alerts even before anything has been given up on: a
// tab stuck on the spinner has, by definition, missed nothing yet.
{
  const s = summarizeIdbContention([], [wait(7, "indexedDB.startup transaction", 3000, 1500)]);
  check("a wait past half its deadline alerts on its own", s.alert && s.rows.length === 0, s);
}

// A wait that has only been waiting because the tab itself was blocked (or
// throttled in the background) has not used its budget: no alert.
{
  const s = summarizeIdbContention([], [wait(8, "indexedDB.read conversation_meta", 250, 20, 900)]);
  check("a stalled tab's in-flight wait does not alert", !s.alert, s);
}

// Stall wording: only worth a mention when it is big enough to matter.
{
  check("no stall, no note", describeStall(0) === "");
  check("timer jitter is not a stall", describeStall(12) === "");
  check("a real stall is named", describeStall(770) === "tab blocked 770ms", describeStall(770));
}

// Outcome wording the details table shows.
{
  check("pending", describeStallOutcome(miss("indexedDB.open", 0)) === "no answer yet");
  check(
    "completed",
    describeStallOutcome(
      miss("indexedDB.open", 0, { outcome: "completed", settledAfterMs: 1840 }),
    ) === "completed after 1.84s",
  );
  check(
    "abandoned",
    describeStallOutcome(
      miss("indexedDB.open", 0, { outcome: "abandoned", settledAfterMs: 300 }),
    ) === "abandoned after 300ms",
  );
  check(
    "failed",
    describeStallOutcome(
      miss("indexedDB.open", 0, {
        outcome: "failed",
        settledAfterMs: 90,
        error: "VersionError: x",
      }),
    ) === "failed after 90ms: VersionError: x",
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`perfHudContention: ${passed} checks passed`);
