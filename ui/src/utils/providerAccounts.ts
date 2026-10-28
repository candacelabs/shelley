export interface ProviderAccountRef {
  id: string;
  label: string;
}

export function accountSuffixes(accounts: ProviderAccountRef[]): Map<string, string> {
  const idsByLabel = new Map<string, string[]>();
  for (const { id, label } of accounts) {
    const key = label.trim().toLocaleLowerCase();
    idsByLabel.set(key, [...(idsByLabel.get(key) ?? []), id]);
  }

  const suffixes = new Map<string, string>();
  for (const ids of idsByLabel.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      let length = Math.min(4, id.length);
      while (ids.some((other) => other !== id && other.slice(0, length) === id.slice(0, length))) {
        length++;
      }
      suffixes.set(id, `#${id.slice(0, length)}`);
    }
  }
  return suffixes;
}
