const MAX_REPORTED_TOOL_NAME_LENGTH = 120;

export function genericToolReportName(toolName: string): string {
  const withoutControlCharacters = Array.from(toolName, (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint < 32 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
  }).join("");
  const normalized = withoutControlCharacters.replace(/\s+/g, " ").trim() || "Unknown tool";
  const characters = Array.from(normalized);
  if (characters.length <= MAX_REPORTED_TOOL_NAME_LENGTH) return normalized;
  return `${characters.slice(0, MAX_REPORTED_TOOL_NAME_LENGTH - 1).join("")}…`;
}

function markdownCodeSpan(value: string): string {
  const longestBacktickRun = Math.max(0, ...(value.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longestBacktickRun + 1);
  const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

export function genericToolReportURL(toolName: string): string {
  const reportedName = genericToolReportName(toolName);
  const body = [
    `**Tool:** ${markdownCodeSpan(reportedName)}`,
    "",
    "**What happened:**",
    "This tool rendered as a generic tool result.",
    "",
    "**Expected UI:**",
    "",
    "**Additional context (Shelley version, screenshot, etc.):**",
    "",
  ].join("\n");
  const params = new URLSearchParams({
    labels: "bug",
    title: `Missing tool UI: ${reportedName}`,
    body,
  });
  return `https://github.com/boldsoftware/shelley/issues/new?${params}`;
}
