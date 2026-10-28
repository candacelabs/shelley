import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationWithState } from "../types";
import { runningSubagents } from "./runningSubagents";

function conversation(
  id: string,
  parent: string | null,
  working = false,
  jobs = 0,
  createdAt = "2026-01-01T00:00:00Z",
): ConversationWithState {
  return {
    conversation_id: id,
    parent_conversation_id: parent,
    working,
    running_background_jobs: jobs,
    created_at: createdAt,
  } as ConversationWithState;
}

test("includes busy descendants through idle ancestors, but not unrelated work", () => {
  const conversations = [
    conversation("grandchild", "idle-child", false, 1, "2026-01-01T00:01:00Z"),
    conversation("unrelated-child", "unrelated", true, 2),
    conversation("root", null, true, 1),
    conversation("idle-child", "root"),
    conversation("working-child", "root", true),
    conversation("finished-child", "root"),
  ];
  assert.deepEqual(
    runningSubagents(conversations, "root").map((c) => c.conversation_id),
    ["working-child", "grandchild"],
  );
  assert.deepEqual(
    runningSubagents(conversations, "idle-child").map((c) => c.conversation_id),
    ["grandchild"],
  );
  assert.deepEqual(runningSubagents(conversations, "grandchild"), []);
});

test("keeps creation order when live updates reorder conversations", () => {
  const older = conversation("older", "root", true);
  const newer = conversation("newer", "root", true, 0, "2026-01-01T00:01:00Z");
  const newest = conversation("newest", "newer", true, 0, "2026-01-01T00:02:00Z");
  const conversations = [newest, newer, older];
  const ids = (items: ConversationWithState[]) =>
    runningSubagents(items, "root").map((c) => c.conversation_id);

  assert.deepEqual(ids(conversations), ["older", "newer", "newest"]);
  assert.deepEqual(conversations, [newest, newer, older]);
  assert.deepEqual(
    ids([
      { ...newer, updated_at: "2026-01-01T01:00:00Z" },
      newest,
      { ...older, working: false, running_background_jobs: 1 },
    ]),
    ["older", "newer", "newest"],
  );
  assert.deepEqual(ids([newest, { ...older, working: false }, newer]), ["newer", "newest"]);
  assert.deepEqual(ids([newer, newest, older]), ["older", "newer", "newest"]);
});

test("breaks creation-time ties by conversation ID, not live list order", () => {
  const a = conversation("a", "root", true);
  const b = conversation("b", "root", true);
  for (const conversations of [
    [b, a],
    [a, b],
  ]) {
    assert.deepEqual(
      runningSubagents(conversations, "root").map((c) => c.conversation_id),
      ["a", "b"],
    );
  }
});
