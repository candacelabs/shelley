import assert from "node:assert/strict";
import {
  parseQueuedMessages,
  queuedMessageText,
  queuedMessageRestoreText,
  queuedTranscriptionPath,
  queuedTranscriptionTaskState,
  type QueuedMessage,
} from "../types";

function queued(id: string, text: string, extra: Partial<QueuedMessage> = {}): QueuedMessage {
  return {
    id,
    llm: { Role: 0, Content: [{ ID: "", Type: 2, Text: text }] },
    created_at: "2026-09-12T00:00:00Z",
    model: "predictable",
    ...extra,
  };
}

const items = [
  queued("ordinary", "first"),
  queued("working", "Keep this [/tmp/context.png]", {
    kind: "transcription",
    state: "working",
    transcription: {
      media_path: "/tmp/working.webm",
      context: "Keep this [/tmp/context.png]",
    },
  }),
  queued("ready", "spoken words", {
    kind: "transcription",
    state: "ready",
    transcription: { media_path: "/tmp/ready.webm" },
  }),
  queued("failed", "", {
    kind: "transcription",
    state: "failed",
    error: "transcription unavailable",
    transcription: { media_path: "/tmp/failed.webm" },
  }),
];

const parsed = parseQueuedMessages(JSON.stringify(items));
assert.deepEqual(
  parsed.map(({ id }) => id),
  ["ordinary", "working", "ready", "failed"],
  "queued messages preserve the server's exact order",
);
assert.equal(queuedTranscriptionTaskState(parsed[0]), null);
assert.equal(queuedTranscriptionTaskState(parsed[1]), "working");
assert.equal(
  queuedTranscriptionTaskState(parsed[2]),
  null,
  "ready transcriptions render as ordinary ghosts",
);
assert.equal(queuedTranscriptionTaskState(parsed[3]), "failed");
assert.equal(queuedTranscriptionPath(parsed[1]), "/tmp/working.webm");
assert.equal(queuedTranscriptionPath(parsed[3]), "/tmp/failed.webm");
assert.equal(queuedMessageText(parsed[2]), "spoken words");
assert.equal(queuedMessageRestoreText(parsed[1]), "Keep this [/tmp/context.png]");
