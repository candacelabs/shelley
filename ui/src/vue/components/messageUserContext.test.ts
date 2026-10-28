import assert from "node:assert/strict";
import type { Message } from "../../types";
import type { CoalescedItem } from "./coalesce";
import { collectReactions, targetResolver } from "./messageUserContext";

let n = 0;
function call(input: unknown, display: unknown, extra: Partial<CoalescedItem> = {}): CoalescedItem {
  n++;
  return {
    type: "tool",
    generation: 1,
    sourceSequenceID: n,
    anchorKey: `a${n}`,
    toolUseId: `tool-${n}`,
    toolName: "message_user",
    toolInput: input,
    display,
    hasResult: true,
    toolError: false,
    ...extra,
  };
}

function user(message_id: string, sequence_id: number, carriedFrom?: number): Message {
  return {
    message_id,
    sequence_id,
    conversation_id: "c",
    type: "user",
    created_at: "2026-10-06T00:00:00Z",
    generation: 1,
    user_data:
      carriedFrom === undefined
        ? undefined
        : JSON.stringify({
            compaction_carried: "true",
            carried_from_sequence_id: String(carriedFrom),
          }),
  };
}

// In the conversation: m1 (seq 1), m2 (seq 3). In a fork, copies get new ids
// and keep their sequence_ids: f1 (seq 1).
const resolve = targetResolver([user("m1", 1), user("m2", 3)]);
assert.equal(resolve({ target_message_id: "m1", target_sequence_id: 1 }), "m1");
assert.equal(resolve({ target_message_id: "gone", target_sequence_id: 3 }), "m2");
assert.equal(resolve({ target_message_id: "gone", target_sequence_id: 2 }), undefined);
assert.equal(resolve({}), undefined);
const forked = targetResolver([user("f1", 1)]);
assert.equal(forked({ target_message_id: "m1", target_sequence_id: 1 }), "f1");
const live = { ...user("live", 11), user_data: JSON.stringify({ live_delivery_id: "delivery-1" }) };
const resolveLive = targetResolver([live]);
assert.equal(resolveLive({ target_sequence_id: 11 }), "live");
assert.deepEqual(
  collectReactions(
    [call({ reaction: "👍", reply_to: 11 }, { target_message_id: "live" })],
    resolveLive,
  ).get("live"),
  [{ emoji: "👍", count: 1 }],
);
// A compaction copied m1 to seq 7, and the copy again to seq 9; originals win.
const compacted = targetResolver([user("m1", 1), user("c1", 7, 1), user("cc1", 9, 1)]);
assert.equal(compacted({ target_message_id: "gone", target_sequence_id: 1 }), "m1");
// A fork of the last generation has only the last copy.
const compactedFork = targetResolver([user("fc1", 9, 1)]);
assert.equal(compactedFork({ target_message_id: "m1", target_sequence_id: 1 }), "fc1");

const carried = call({ reaction: "🔁", reply_to: 3 }, { target_message_id: "m2" });
const reactions = collectReactions(
  [
    call({ reaction: "👍", reply_to: 2 }, { target_message_id: "m1" }),
    call({ reaction: "👍", text: "yes", reply_to: 2 }, { target_message_id: "m1" }),
    call({ reaction: "🎉", reply_to: 3 }, { target_message_id: "m2" }),
    carried,
    // A compaction's copy of a call is the same call.
    { ...carried, carried: true, anchorKey: "copy" },
    // Not reactions: failed, plain replies, unresolved targets, other tools.
    call({ reaction: "❌", reply_to: 2 }, {}, { toolError: true }),
    call({ text: "reply", reply_to: 2 }, { target_message_id: "m1" }),
    call({ reaction: "👻", reply_to: 99 }, { target_message_id: "elsewhere" }),
    call({ reaction: "🛠" }, { target_message_id: "m1" }, { toolName: "bash" }),
  ],
  resolve,
);
assert.deepEqual(reactions.get("m1"), [{ emoji: "👍", count: 2 }]);
assert.deepEqual(reactions.get("m2"), [
  { emoji: "🎉", count: 1 },
  { emoji: "🔁", count: 1 },
]);
assert.equal(reactions.size, 2);

console.log("messageUserContext tests passed");
