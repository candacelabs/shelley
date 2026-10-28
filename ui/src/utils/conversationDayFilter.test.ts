import assert from "node:assert/strict";
import { filterConversationsByDay, shiftLocalDay } from "./conversationDayFilter";

const originalTZ = process.env.TZ;
try {
  process.env.TZ = "America/New_York";
  const day = new Date(2026, 9, 8, 15);
  const conversations = [
    { id: "before", updated_at: "2026-10-08T03:59:59.999Z" },
    { id: "start", updated_at: "2026-10-08T04:00:00Z" },
    { id: "end", updated_at: "2026-10-09T03:59:59.999Z" },
    { id: "after", updated_at: "2026-10-09T04:00:00Z" },
  ];
  assert.deepEqual(
    filterConversationsByDay(conversations, day).map((c) => c.id),
    ["start", "end"],
    "matches last-touched timestamps within the local day, preserving order",
  );
  assert.equal(filterConversationsByDay(conversations, null), conversations);
  assert.deepEqual(filterConversationsByDay([], day), []);
  assert.equal(shiftLocalDay(new Date(2026, 0, 1), -1).getFullYear(), 2025);
  assert.equal(shiftLocalDay(new Date(2026, 0, 31), 1).getMonth(), 1);
  assert.equal(shiftLocalDay(new Date(2024, 1, 28), 1).getDate(), 29);
  assert.equal(shiftLocalDay(day, 0).getHours(), 0);

  for (const [date, hours] of [
    [new Date(2026, 2, 8), 23],
    [new Date(2026, 10, 1), 25],
  ] as const) {
    const start = shiftLocalDay(date, 0).getTime();
    const end = shiftLocalDay(date, 1).getTime();
    assert.equal((end - start) / 3_600_000, hours, "uses calendar days across DST");
    assert.deepEqual(
      filterConversationsByDay(
        [
          { id: "last", updated_at: new Date(end - 1).toISOString() },
          { id: "next", updated_at: new Date(end).toISOString() },
        ],
        date,
      ).map((c) => c.id),
      ["last"],
    );
  }
  console.log("✓ conversation day filtering: local boundaries, paging, and DST");
} finally {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
}
