// Auto compaction: the compact_in_place tool, plus context-size nudges from
// compact_nudge_tokens on (see server/compact_in_place.go).
export const COMPACT_IN_PLACE_TOOL = "compact_in_place";

// Mirrors defaultCompactNudgeTokens in server/compact_in_place.go.
export const DEFAULT_COMPACT_NUDGE_TOKENS = 200_000;

// What the "Compact in Place" button sends to the agent.
export const COMPACT_IN_PLACE_REQUEST = "Compact your context in place.";

const COMPACT_NUDGE_CHOICES = [100_000, 130_000, 160_000, 200_000, 250_000, 300_000, 400_000];

/** The nudges to choose from, with the current one even if the API set it
 *  to another. */
export function compactNudgeChoices(current: number): number[] {
  return COMPACT_NUDGE_CHOICES.includes(current)
    ? COMPACT_NUDGE_CHOICES
    : [...COMPACT_NUDGE_CHOICES, current].sort((a, b) => a - b);
}
