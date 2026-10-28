import assert from "node:assert/strict";
import { LiveTranscript, readLiveDeliveryID } from "./liveTranscript";
import { type Message, type QueuedMessage } from "../types";

const transcript = new LiveTranscript();
transcript.append(true, "Hi.", 0, 300);
transcript.append(false, "Hello", 400, 800);
transcript.append(false, " there.", 800, 1200);
assert.deepEqual(transcript.turns, [
  { user: true, text: "Hi." },
  { user: false, text: "Hello there." },
]);

// The receipt and the saved row can arrive in either order.
transcript.handoff(3, "saved-delivery");
transcript.reconcile([]);
assert.equal(transcript.turns.length, 2);
transcript.append(false, " Still here.", 1300, 1700);
transcript.reconcile(["saved-delivery"]);
assert.deepEqual(transcript.turns, [{ user: false, text: " Still here." }]);

// Replaying a receipt must not consume speech that followed its snapshot.
transcript.handoff(3, "saved-delivery");
transcript.reconcile(["saved-delivery"]);
assert.deepEqual(transcript.turns, [{ user: false, text: " Still here." }]);

transcript.append(true, "Another request.", 2000, 2500);
transcript.reconcile(["saved-delivery", "queued-delivery"]);
assert.equal(transcript.turns.length, 2);
transcript.handoff(5, "queued-delivery");
transcript.reconcile(["saved-delivery", "queued-delivery"]);
assert.deepEqual(transcript.turns, []);

// Deltas still count when they carry no visible text.
transcript.append(false, "", 2600, 2600);
transcript.append(false, "Next reply.", 2700, 3000);
transcript.handoff(6, "empty-delivery");
transcript.reconcile(["empty-delivery"]);
assert.deepEqual(transcript.turns, [{ user: false, text: "Next reply." }]);

// A new call starts with a fresh counter and no pending exchange.
assert.deepEqual(new LiveTranscript().turns, []);

const overlapping = new LiveTranscript();
overlapping.append(true, "The transcript keeps", 0, 1200);
overlapping.append(false, "Mm-hmm.", 900, 1300);
overlapping.append(true, " splitting up.", 1300, 2500);
assert.deepEqual(overlapping.turns, [
  { user: true, text: "The transcript keeps splitting up." },
  { user: false, text: "Mm-hmm." },
]);
overlapping.append(false, "I see.", 3000, 4000);
overlapping.append(true, "A new thought.", 5000, 6000);
assert.deepEqual(overlapping.turns.slice(2), [
  { user: false, text: "I see." },
  { user: true, text: "A new thought." },
]);

// A distinct question always keeps its answer in chronological order, even after a short pause.
const question = new LiveTranscript();
question.append(true, "Change the setting.", 0, 1000);
question.append(false, "Production or staging?", 2000, 3000);
question.append(true, "Staging.", 3100, 3600);
assert.deepEqual(question.turns, [
  { user: true, text: "Change the setting." },
  { user: false, text: "Production or staging?" },
  { user: true, text: "Staging." },
]);

// A long pause remains part of a thought only when nobody else spoke in between.
const pause = new LiveTranscript();
pause.append(true, "Run tests", 0, 1000);
pause.append(true, " and lint.", 4000, 5000);
assert.deepEqual(pause.turns, [{ user: true, text: "Run tests and lint." }]);

// Provider delivery order does not determine the visible speaker ordering.
const delayed = new LiveTranscript();
delayed.append(false, "Hey!", 500, 800);
delayed.append(true, "Hey Shelley, ", 0, 1000);
delayed.append(true, "how's it going?", 1000, 2000);
assert.deepEqual(delayed.turns, [
  { user: true, text: "Hey Shelley, how's it going?" },
  { user: false, text: "Hey!" },
]);
const sparse = new LiveTranscript();
sparse.append(true, "A new request.", 4000, 5000);
sparse.append(false, "The old reply's tail.", 2000, 3000);
const sparseUnsent = [
  { user: false, text: "The old reply's tail." },
  { user: true, text: "A new request." },
];
assert.deepEqual(sparse.turns, sparseUnsent);
sparse.append(true, "Late old instruction.", 0, 1000);
sparse.handoff(3, "continued-delivery", [3]);
sparse.reconcile([]);
assert.equal(sparse.turns.length, 3);
sparse.reconcile(["continued-delivery"]);
assert.deepEqual(sparse.turns, sparseUnsent);
sparse.handoff(3, "continued-delivery", [3]);
sparse.reconcile(["continued-delivery"]);
assert.deepEqual(sparse.turns, sparseUnsent);

// A punctuation-only late fragment cannot create an orphan turn after its handoff is consumed.
const orphan = new LiveTranscript();
orphan.append(true, "Run tests", 0, 1000);
orphan.handoff(1, "run-tests");
orphan.reconcile(["run-tests"]);
orphan.append(true, "\n.", 1000, 1000);
orphan.append(true, " Also lint", 3000, 4000);
assert.deepEqual(orphan.turns, [{ user: true, text: " Also lint" }]);

// A late sentence closer cannot bridge an intervening reply.
const latePunctuation = new LiveTranscript();
latePunctuation.append(true, "Run tests", 0, 1000);
latePunctuation.append(false, "Sure.", 1200, 1800);
latePunctuation.append(true, "\n.", 2000, 2000);
assert.deepEqual(latePunctuation.turns, [
  { user: true, text: "Run tests" },
  { user: false, text: "Sure." },
]);

const punctuationTiming = new LiveTranscript();
punctuationTiming.append(false, "First", 0, 1000);
punctuationTiming.append(false, "\n.", 4000, 4000);
punctuationTiming.append(false, "Again.", 5000, 6000);
assert.deepEqual(punctuationTiming.turns, [
  { user: false, text: "First." },
  { user: false, text: "Again." },
]);

const openingQuote = new LiveTranscript();
openingQuote.append(true, '"', 0, 0);
openingQuote.append(true, "quoted thought", 100, 500);
assert.deepEqual(openingQuote.turns, [{ user: true, text: '"quoted thought' }]);

const symbolSpeech = new LiveTranscript();
symbolSpeech.append(true, "+", 0, 0);
assert.deepEqual(symbolSpeech.turns, [{ user: true, text: "+" }]);

// Receipts may arrive out of handoff order; identity reconciliation remains deterministic.
const receipts = new LiveTranscript();
receipts.append(true, "One.", 0, 100);
receipts.append(true, "Two.", 200, 300);
receipts.append(true, "Three.", 400, 500);
receipts.handoff(3, "third-delivery", [3]);
receipts.handoff(2, "second-delivery", [2]);
receipts.reconcile(["third-delivery"]);
assert.deepEqual(receipts.turns, [{ user: true, text: "One.Two." }]);
receipts.reconcile(["second-delivery"]);
assert.deepEqual(receipts.turns, [{ user: true, text: "One." }]);

// Queue and saved-row receipts share the same immutable delivery identity.
const queued = {
  id: "queued",
  user_data: { live_delivery_id: "same-delivery" },
} as QueuedMessage;
const saved = {
  message_id: "saved",
  type: "user",
  user_data: JSON.stringify({ live_delivery_id: "same-delivery" }),
} as Message;
assert.equal(readLiveDeliveryID(queued), "same-delivery");
assert.equal(readLiveDeliveryID(saved), "same-delivery");
console.log("liveTranscript tests passed");
