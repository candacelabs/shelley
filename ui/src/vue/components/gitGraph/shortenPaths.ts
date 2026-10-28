export function pathShortener(
  paths: string[],
): (fits: (label: string) => boolean) => Map<string, string> {
  const entries = [...new Set(paths)].map((path) => ({ path, parts: path.split("/") }));
  const suffixCounts = new Map<string, number>();
  for (const { parts } of entries) {
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join("/");
      suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
    }
  }
  const prepared = entries.map(({ path, parts }) => {
    let start = parts.length - 1;
    while (start > 0 && suffixCounts.get(parts.slice(start).join("/"))! > 1) start--;
    return { path, parts, start };
  });

  return (fits) => {
    const shortened = prepared.map(({ path, parts, start }) => {
      const kept = new Set(fits(path) ? parts.keys() : [0, start, parts.length - 1]);
      for (let i = deepestMissing(parts, kept); i > 0; i = deepestMissing(parts, kept)) {
        kept.add(i);
        if (fits(label(parts, kept))) continue;
        kept.delete(i);
        break;
      }
      return { path, parts, kept };
    });

    while (true) {
      const groups = new Map<string, typeof shortened>();
      for (const entry of shortened) {
        const text = label(entry.parts, entry.kept);
        const group = groups.get(text) ?? [];
        group.push(entry);
        groups.set(text, group);
      }
      let added = false;
      for (const group of groups.values()) {
        if (group.length === 1) continue;
        for (const { parts, kept } of group) {
          const i = deepestMissing(parts, kept);
          if (i < 0) continue;
          kept.add(i);
          added = true;
        }
      }
      if (!added) break;
    }

    return new Map(
      shortened.map(({ path, parts, kept }) => {
        const text = label(parts, kept);
        return [path, text.length < path.length ? text : path];
      }),
    );
  };
}

function deepestMissing(parts: string[], kept: Set<number>): number {
  for (let i = parts.length - 2; i > 0; i--) if (!kept.has(i)) return i;
  return -1;
}

function label(parts: string[], kept: Set<number>): string {
  const pieces: string[] = [];
  let previous = -1;
  for (let i = 0; i < parts.length; i++) {
    if (!kept.has(i)) continue;
    if (i > previous + 1) pieces.push("…");
    pieces.push(parts[i]);
    previous = i;
  }
  return pieces.join("/");
}
