import type { Point } from "./contextComposition";
import {
  categoryHint,
  categoryTokens,
  contextCategories,
  contextLayers,
  contextSegmentStarts,
} from "./contextCategories";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

const point = (parts: Record<string, number>, segment = 0): Point => ({
  total: Object.values(parts).reduce((a, b) => a + b, 0),
  segment,
  parts,
  toolBreakdown: { "repo/read": { "a.go": 3000, "b.go": 1000 } },
  prompt: parts,
});
const points = [
  point({ user: 100, assistant: 50 }),
  point({ user: 100, assistant: 80, reasoning: 20, "repo/read": 4000, "bash:other": 10 }, 0),
  point({ user: 30, "bash:other": 5 }, 1),
];

const cats = contextCategories(points);
assert(
  cats.map((c) => c.key).join() === "text,repo/read,bash:other",
  `categories in stacking order: ${cats.map((c) => c.key)}`,
);
assert(contextCategories([]).length === 0, "no points, no categories");

assert(categoryTokens(points[1], "text") === 200, "text folds user, assistant and reasoning");
assert(categoryTokens(points[1], "repo/read") === 4000, "other categories read their own part");
assert(categoryTokens(points[0], "repo/read") === 0, "missing parts are zero");

const layers = contextLayers(points, cats);
assert(layers.length === 3 && layers[0].length === 3, "a layer per category, a value per call");
assert(layers[0].join() === "150,200,30", `bottom layer is its own tokens: ${layers[0]}`);
assert(layers[1].join() === "150,4200,30", `layers stack: ${layers[1]}`);
assert(layers[2].join() === "150,4210,35", `top layer is the plotted total: ${layers[2]}`);

assert(contextSegmentStarts(points).join() === "2", "compaction starts a segment");
assert(contextSegmentStarts(points.slice(0, 2)).length === 0, "no compaction, no starts");

assert(categoryHint("text", points[1]) === "user 100 · assistant 80 · reasoning 20", "text hint");
assert(categoryHint("repo/read", points[1]) === "a.go 3k · b.go 1k", "tool hint, biggest first");
assert(categoryHint("bash:other", points[1]) === "Tool output", "tool hint without breakdown");

if (failed) process.exit(1);
console.log("✓ context categories");
