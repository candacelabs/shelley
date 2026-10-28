import assert from "node:assert/strict";
import { genericToolReportName, genericToolReportURL } from "./genericToolReport";

const shortToolName = "custom tool & action=#100% 雪";
const shortURL = new URL(genericToolReportURL(shortToolName));

assert.equal(
  `${shortURL.origin}${shortURL.pathname}`,
  "https://github.com/boldsoftware/shelley/issues/new",
);
assert.equal(shortURL.searchParams.get("labels"), "bug");
assert.equal(shortURL.searchParams.get("title"), `Missing tool UI: ${shortToolName}`);
const shortBody = shortURL.searchParams.get("body") || "";
assert.ok(shortBody.includes(shortToolName));
assert.ok(shortBody.includes("Shelley version, screenshot"));

const hostileToolName = `custom \`tool\`\u0000\n${"雪".repeat(160)}`;
const reportedName = genericToolReportName(hostileToolName);
const hostileURL = new URL(genericToolReportURL(hostileToolName));
const hostileBody = hostileURL.searchParams.get("body") || "";
assert.equal(Array.from(reportedName).length, 120);
assert.ok(reportedName.endsWith("…"));
assert.ok(!reportedName.includes("\n"));
assert.ok(!reportedName.includes("\u0000"));
assert.equal(hostileURL.searchParams.get("title"), `Missing tool UI: ${reportedName}`);
assert.ok(hostileBody.startsWith(`**Tool:** \`\`${reportedName}\`\``));

console.log("genericToolReportURL tests passed");
