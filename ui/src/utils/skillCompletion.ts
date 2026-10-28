import type { SkillDescriptor } from "../services/api";

export interface SkillToken {
  start: number;
  end: number;
  query: string;
}

/** /skills is a command only at the very start of the draft. Its query runs
 * to the caret on the first line; prose that merely mentions /skills is not a
 * command. */
export function skillTokenAt(
  text: string,
  cursor: number,
  selectionEnd = cursor,
): SkillToken | null {
  if (cursor !== selectionEnd || cursor < 0 || cursor > text.length) return null;
  if (!/^\/skills(?=$|\s)/.test(text) || cursor < "/skills".length) return null;
  const query = text.slice("/skills".length, cursor);
  if (/[\r\n]/.test(query)) return null;
  return { start: 0, end: cursor, query: query.trim() };
}

export function filterSkills(skills: SkillDescriptor[], query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return skills.filter((skill) => {
    const text = `${skill.name} ${skill.description}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

/** Removes the /skills command from the draft; the chosen skill becomes a chip. */
export function removeSkillToken(text: string, token: SkillToken) {
  const rest = text.slice(token.end).replace(/^[ \t]*\r?\n?/, "");
  return { text: text.slice(0, token.start) + rest, cursor: token.start };
}
