import type { Model } from "../../types";
import { recentModelCombinations } from "./recentModelCombinations";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-09-12T12:00:00Z");

type Conversation = Parameters<typeof recentModelCombinations>[0][number];

function conversation(
  model: string,
  thinkingLevel: string | undefined,
  daysAgo: number,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    archived: false,
    conversation_options: thinkingLevel ? JSON.stringify({ thinking_level: thinkingLevel }) : "{}",
    is_draft: false,
    model,
    parent_conversation_id: null,
    updated_at: new Date(now - daysAgo * DAY).toISOString(),
    user_initiated: true,
    ...overrides,
  };
}

const models: Pick<
  Model,
  "default_reasoning_level" | "id" | "ready" | "reasoning_levels" | "supports_reasoning"
>[] = [
  { id: "sol", ready: true, supports_reasoning: true, default_reasoning_level: "medium" },
  { id: "astra", ready: true, supports_reasoning: true, default_reasoning_level: "low" },
  { id: "fable", ready: true, supports_reasoning: true, default_reasoning_level: "high" },
  { id: "plain", ready: true, supports_reasoning: false },
  { id: "stale", ready: false, supports_reasoning: true, default_reasoning_level: "medium" },
  {
    id: "limited",
    ready: true,
    supports_reasoning: true,
    reasoning_levels: ["low", "medium"],
    default_reasoning_level: "low",
  },
];

let passed = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (!condition) {
    console.error(`✗ ${name}`, detail ?? "");
    process.exit(1);
  }
  passed++;
}

const diverse = recentModelCombinations(
  [
    ...Array.from({ length: 8 }, (_, i) => conversation("sol", "medium", i)),
    ...Array.from({ length: 6 }, (_, i) => conversation("sol", "high", i)),
    conversation("astra", "low", 1),
    conversation("fable", "high", 2),
  ],
  models,
  now,
);
check(
  "returns one combination per model before repeating a model",
  diverse.map((combination) => combination.modelId).join(",") === "sol,astra,fable",
  diverse,
);
check(
  "keeps the strongest combination for a model",
  diverse[0]?.thinkingLevel === "medium",
  diverse,
);

const recencyBiased = recentModelCombinations(
  [
    ...Array.from({ length: 4 }, () => conversation("sol", "medium", 80)),
    conversation("astra", "low", 0),
  ],
  models,
  now,
  2,
);
check(
  "recent use outranks a larger stale count",
  recencyBiased[0]?.modelId === "astra",
  recencyBiased,
);

const filtered = recentModelCombinations(
  [
    conversation("sol", undefined, 1),
    conversation("plain", undefined, 1),
    conversation("stale", "medium", 1),
    conversation("astra", "low", 91),
    conversation("fable", "high", 1, { is_draft: true }),
    conversation("fable", "high", 1, { parent_conversation_id: "parent" }),
  ],
  models,
  now,
);
check(
  "uses concrete model defaults and keeps non-reasoning models",
  filtered.length === 2 &&
    filtered.some(
      (combination) => combination.modelId === "sol" && combination.thinkingLevel === "medium",
    ) &&
    filtered.some(
      (combination) => combination.modelId === "plain" && combination.thinkingLevel === null,
    ),
  filtered,
);

const currentCapabilities = recentModelCombinations(
  [
    conversation("limited", "max", 0),
    conversation("plain", "high", 1),
    conversation("sol", "medium", 1, { conversation_options: "{" }),
  ],
  models,
  now,
);
check(
  "normalizes historical levels against current model capabilities",
  currentCapabilities.some(
    (combination) => combination.modelId === "limited" && combination.thinkingLevel === "medium",
  ),
  currentCapabilities,
);
check(
  "treats a stale explicit level on a non-reasoning model as no reasoning",
  currentCapabilities.some(
    (combination) => combination.modelId === "plain" && combination.thinkingLevel === null,
  ),
  currentCapabilities,
);
check(
  "skips malformed conversation options",
  !currentCapabilities.some((combination) => combination.modelId === "sol"),
  currentCapabilities,
);

console.log(`recentModelCombinations: ${passed} passed`);
