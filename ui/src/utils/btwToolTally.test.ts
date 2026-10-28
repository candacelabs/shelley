import assert from "node:assert/strict";
import type { BtwToolCall } from "../types";
import { btwToolCallTooltip } from "./btwToolTally";

const cases: Array<[BtwToolCall[] | undefined, string]> = [
  [
    [{ name: "bash" }, { name: "read_image" }, { name: "bash" }, { name: "legacy" }],
    "• bash ×2\n• read_image\n• legacy",
  ],
  [
    [
      { name: "bash", command: "  rg -n 'ToolInput' server/\nui/src/  " },
      { name: "read_image" },
      { name: "read_image" },
      { name: "bash", command: " \n " },
    ],
    "• bash — rg ToolInput\n• read_image ×2\n• bash",
  ],
  [
    [{ name: "bash", command: "cd /repo && go test ./server -run TestBTW" }],
    "• bash — go test ./server",
  ],
  [[{ name: "bash", command: "git status && git diff" }], "• bash — git status"],
  [undefined, ""],
];

for (const [calls, expected] of cases) assert.equal(btwToolCallTooltip(calls), expected);

console.log("btwToolTally tests passed");
