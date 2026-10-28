import { strict as assert } from "node:assert";
import { elapsedSince } from "./toolElapsed";

const start = "2026-09-24T12:00:00Z";
const at = (ms: number) => Date.parse(start) + ms;

assert.equal(elapsedSince(start, at(0)), "0s");
assert.equal(elapsedSince(start, at(12_990)), "12s");
assert.equal(elapsedSince(start, at(59_000)), "59s");
assert.equal(elapsedSince(start, at(61_000)), "1m 01s");
assert.equal(elapsedSince(start, at(3_723_000)), "1h 02m 03s");
assert.equal(elapsedSince(start, at(-2_000)), "0s");
assert.equal(elapsedSince(null, at(1_000)), "");
assert.equal(elapsedSince("not a date", at(1_000)), "");

console.log("toolElapsed tests passed");
