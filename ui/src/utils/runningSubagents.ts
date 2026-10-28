import type { ConversationWithState } from "../types";

export function runningSubagents(
  conversations: ConversationWithState[],
  conversationId: string,
): ConversationWithState[] {
  const children = new Map<string, ConversationWithState[]>();
  for (const conversation of conversations) {
    const parent = conversation.parent_conversation_id;
    if (!parent) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(conversation);
    children.set(parent, siblings);
  }
  const descendants: ConversationWithState[] = [];
  const pending = [conversationId];
  for (let i = 0; i < pending.length; i++) {
    for (const child of children.get(pending[i]) ?? []) {
      descendants.push(child);
      pending.push(child.conversation_id);
    }
  }
  return descendants
    .filter((c) => c.working || c.running_background_jobs > 0)
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) ||
        a.conversation_id.localeCompare(b.conversation_id),
    );
}
