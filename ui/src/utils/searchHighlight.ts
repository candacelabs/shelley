export function highlightSearchMatches(text: string, query: string) {
  if (!text || !query.trim()) return [{ text, mark: false }];

  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const segments: { text: string; mark: boolean }[] = [];
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    if (index > start) segments.push({ text: text.slice(start, index), mark: false });
    segments.push({ text: match[0], mark: true });
    start = index + match[0].length;
  }
  if (start < text.length) segments.push({ text: text.slice(start), mark: false });
  return segments;
}
