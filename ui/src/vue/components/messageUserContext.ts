// What message_user calls need from the conversation around them: which
// rendered message a reply or reaction targets, the reactions on each user
// message (Message.vue shows them), and jumping to a target. ChatInterface
// provides it.
import type { ComputedRef, InjectionKey } from "vue";
import type { Message } from "../../types";
import type { CoalescedItem } from "./coalesce";
import {
  MESSAGE_USER_TOOL,
  messageUserDisplay,
  isTypedUserMessage,
  messageUserInput,
  type MessageUserDisplay,
} from "../../utils/conversationView";

export interface MessageReaction {
  emoji: string;
  count: number;
}

export type TargetResolver = (display: MessageUserDisplay) => string | undefined;

export interface MessageUserContext {
  reactions: ComputedRef<Map<string, MessageReaction[]>>;
  resolveTarget: ComputedRef<TargetResolver>;
  jumpTo(messageId: string): void;
}

export const messageUserContextKey: InjectionKey<MessageUserContext> = Symbol("messageUserContext");

/** The sequence_id of the message that a compaction's copy was first copied
 * from, or the message's own. */
function originSequenceId(message: Message): number {
  if (!message.user_data) return message.sequence_id;
  try {
    const userData =
      typeof message.user_data === "string" ? JSON.parse(message.user_data) : message.user_data;
    const from = userData?.carried_from_sequence_id;
    return typeof from === "string" ? Number(from) : message.sequence_id;
  } catch {
    // isTypedUserMessage shows a message with malformed user_data; so be it.
    return message.sequence_id;
  }
}

/** Resolves a call's target to the id of a message in messages: the stored
 * id; else, as a fork copies messages with new ids but their sequence_ids,
 * and a compaction's copies record their original's, the first message with
 * the stored sequence_id as its own or its original's. */
export function targetResolver(messages: Message[]): TargetResolver {
  const ids = new Set<string>();
  const bySequence = new Map<number, string>();
  for (const m of messages) {
    if (!isTypedUserMessage(m)) continue;
    ids.add(m.message_id);
    const seq = originSequenceId(m);
    if (!bySequence.has(seq)) bySequence.set(seq, m.message_id);
  }
  return (d) => {
    if (d.target_message_id && ids.has(d.target_message_id)) return d.target_message_id;
    return d.target_sequence_id ? bySequence.get(d.target_sequence_id) : undefined;
  };
}

/** The reactions on each message, by message id. A compaction's carried copy
 * of a call shares the original's tool use id and is counted once. */
export function collectReactions(
  items: CoalescedItem[],
  resolve: TargetResolver,
): Map<string, MessageReaction[]> {
  const out = new Map<string, MessageReaction[]>();
  const seen = new Set<string>();
  for (const item of items) {
    if (item.type !== "tool" || item.toolName !== MESSAGE_USER_TOOL) continue;
    if (!item.hasResult || item.toolError || !item.toolUseId || seen.has(item.toolUseId)) continue;
    seen.add(item.toolUseId);
    const emoji = messageUserInput(item.toolInput).reaction?.trim();
    const target = resolve(messageUserDisplay(item.display));
    if (!emoji || !target) continue;
    const list = out.get(target) ?? [];
    const existing = list.find((r) => r.emoji === emoji);
    if (existing) existing.count++;
    else list.push({ emoji, count: 1 });
    out.set(target, list);
  }
  return out;
}
