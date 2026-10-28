import type { ConversationWithState, Model } from "../../types";
import {
  CONCRETE_THINKING_LEVELS,
  normalizeThinkingLevelForModel,
  type ThinkingLevel,
} from "./thinkingLevel";

export type RecentThinkingLevel = Exclude<ThinkingLevel, "default"> | null;

export interface RecentModelCombination {
  modelId: string;
  thinkingLevel: RecentThinkingLevel;
}

type RecentConversation = Pick<
  ConversationWithState,
  | "archived"
  | "conversation_options"
  | "is_draft"
  | "model"
  | "parent_conversation_id"
  | "updated_at"
  | "user_initiated"
>;

type RecentModel = Pick<
  Model,
  "default_reasoning_level" | "id" | "ready" | "reasoning_levels" | "supports_reasoning"
>;

const RECENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const concreteLevels = new Set<string>(CONCRETE_THINKING_LEVELS);

interface RankedCombination extends RecentModelCombination {
  count: number;
  lastUsedAt: number;
  score: number;
}

function effectiveThinkingLevel(
  conversationOptions: string,
  model: RecentModel,
): RecentThinkingLevel | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(conversationOptions);
  } catch {
    return undefined;
  }

  const storedLevel =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as { thinking_level?: unknown }).thinking_level
      : undefined;

  let level: Exclude<ThinkingLevel, "default"> | undefined;
  if (typeof storedLevel === "string") {
    if (!concreteLevels.has(storedLevel)) return undefined;
    level = storedLevel as Exclude<ThinkingLevel, "default">;
  }

  if (model.supports_reasoning === false) return null;
  if (!level && concreteLevels.has(model.default_reasoning_level || "")) {
    level = model.default_reasoning_level as Exclude<ThinkingLevel, "default">;
  }
  if (!level) return undefined;

  const normalized = normalizeThinkingLevelForModel(level, model);
  return normalized === "default" ? undefined : normalized;
}

export function recentModelCombinations(
  conversations: readonly RecentConversation[],
  models: readonly RecentModel[],
  now = Date.now(),
  limit = 3,
): RecentModelCombination[] {
  const readyModels = new Map(
    models.filter((model) => model.ready).map((model) => [model.id, model]),
  );
  const combinations = new Map<string, RankedCombination>();

  for (const conversation of conversations) {
    if (
      conversation.archived ||
      conversation.is_draft ||
      !conversation.user_initiated ||
      conversation.parent_conversation_id ||
      !conversation.model
    ) {
      continue;
    }
    const model = readyModels.get(conversation.model);
    if (!model) continue;

    const updatedAt = Date.parse(conversation.updated_at);
    if (!Number.isFinite(updatedAt)) {
      throw new Error(`invalid updated_at: ${conversation.updated_at}`);
    }
    const age = Math.max(0, now - updatedAt);
    if (age > RECENT_WINDOW_MS) continue;

    const thinkingLevel = effectiveThinkingLevel(conversation.conversation_options, model);
    if (thinkingLevel === undefined) continue;

    const key = `${model.id}\0${thinkingLevel || ""}`;
    const existing = combinations.get(key) || {
      modelId: model.id,
      thinkingLevel,
      count: 0,
      lastUsedAt: updatedAt,
      score: 0,
    };
    existing.count++;
    existing.lastUsedAt = Math.max(existing.lastUsedAt, updatedAt);
    existing.score += 2 ** (-age / RECENCY_HALF_LIFE_MS);
    combinations.set(key, existing);
  }

  const ranked = [...combinations.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.count - a.count ||
      b.lastUsedAt - a.lastUsedAt ||
      a.modelId.localeCompare(b.modelId) ||
      String(a.thinkingLevel).localeCompare(String(b.thinkingLevel)),
  );

  const selected: RecentModelCombination[] = [];
  const selectedModels = new Set<string>();
  for (const combination of ranked) {
    if (selectedModels.has(combination.modelId)) continue;
    selected.push({
      modelId: combination.modelId,
      thinkingLevel: combination.thinkingLevel,
    });
    selectedModels.add(combination.modelId);
    if (selected.length === limit) break;
  }
  return selected;
}
