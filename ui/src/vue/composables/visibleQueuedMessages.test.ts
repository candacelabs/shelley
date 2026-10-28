import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { effectScope, nextTick, shallowRef } from "vue";
import type { QueuedMessage } from "../../types";
import { useVisibleQueuedMessages } from "./visibleQueuedMessages";

const NOW = Date.parse("2026-10-11T00:00:00Z");

function notice(id: string, age = 0): QueuedMessage {
  return {
    id,
    created_at: new Date(NOW - age).toISOString(),
    model: "predictable",
    user_data: {
      sender_conversation_id: "child",
      sender_slug: "worker",
      sender_relationship: "subagent",
    },
  };
}

function harness(t: TestContext, messages: QueuedMessage[]) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  const queued = shallowRef(messages);
  const scope = effectScope();
  const visible = scope.run(() => useVisibleQueuedMessages(() => queued.value))!;
  t.after(() => scope.stop());
  return { queued, visible, scope };
}

test("a quickly drained subagent notice never appears as queued", async (t) => {
  const h = harness(t, [notice("brief")]);
  assert.deepEqual(h.visible.value, []);
  t.mock.timers.tick(1999);
  assert.deepEqual(h.visible.value, []);
  h.queued.value = [];
  await nextTick();
  t.mock.timers.tick(2000);
  assert.deepEqual(h.visible.value, []);
});

test("a notice still queued after two seconds becomes visible", (t) => {
  const message = notice("waiting");
  const h = harness(t, [message]);
  t.mock.timers.tick(1999);
  assert.deepEqual(h.visible.value, []);
  t.mock.timers.tick(1);
  assert.deepEqual(h.visible.value, [message]);
});

test("already waiting notices appear immediately", (t) => {
  const message = notice("old", 2000);
  const h = harness(t, [message]);
  assert.deepEqual(h.visible.value, [message]);
});

test("queue updates preserve each notice's age and server order", async (t) => {
  const first = notice("first", 1500);
  const second = notice("second");
  const h = harness(t, [first, second]);
  t.mock.timers.tick(250);
  h.queued.value = [{ ...first }, { ...second }];
  await nextTick();
  t.mock.timers.tick(250);
  assert.deepEqual(
    h.visible.value.map(({ id }) => id),
    ["first"],
  );
  t.mock.timers.tick(1500);
  assert.deepEqual(
    h.visible.value.map(({ id }) => id),
    ["first", "second"],
  );
});

test("human messages and transcription tasks remain immediate", (t) => {
  const human = { ...notice("human"), user_data: undefined };
  const tasks = (["working", "failed", "ready"] as const).map((state) => ({
    ...notice(state),
    kind: "transcription" as const,
    state,
  }));
  const h = harness(t, [notice("hidden"), human, ...tasks]);
  assert.deepEqual(h.visible.value, [human, ...tasks]);
});

test("background job notices use the same grace period", (t) => {
  const job = { ...notice("job"), user_data: { background_job_id: "job" } };
  const h = harness(t, [job]);
  assert.deepEqual(h.visible.value, []);
  t.mock.timers.tick(2000);
  assert.deepEqual(h.visible.value, [job]);
});

test("replacing the queue cancels a previous conversation's reveal", async (t) => {
  const h = harness(t, [notice("previous")]);
  t.mock.timers.tick(500);
  const current = { ...notice("current"), created_at: new Date(Date.now()).toISOString() };
  h.queued.value = [current];
  await nextTick();
  t.mock.timers.tick(1500);
  assert.deepEqual(h.visible.value, []);
  t.mock.timers.tick(500);
  assert.deepEqual(h.visible.value, [current]);
});

test("unmount cancels pending reveals", (t) => {
  const h = harness(t, [notice("unmounted")]);
  h.scope.stop();
  t.mock.timers.tick(2000);
  assert.deepEqual(h.visible.value, []);
});
