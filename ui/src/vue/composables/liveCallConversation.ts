import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { LiveConversationSettings } from "../../services/api";
import { messageStore } from "../../services/messageStore";
import type { Conversation, Message } from "../../types";

/** Captured on the call tap, before microphone permission or network awaits. */
export interface LiveCallDestination {
  conversationId: string | null;
  conversation?: Conversation;
  /** A draft's selection, sent with the call and its delegations. */
  settings?: LiveConversationSettings;
  /** Creates the draft for /new; called only once the call can proceed. */
  prepareConversation: () => Promise<string>;
}

/** A call's own view of the conversation it started in, kept while the
 *  user browses other chats: its row and a store subscription independent
 *  of the conversation on screen. */
export function useLiveCallConversation(getConversation: (id: string) => Conversation | undefined) {
  const conversationId = ref<string | null>(null);
  const conversation = shallowRef<Conversation>();
  const messages = shallowRef<Message[]>([]);
  let unsubscribe: (() => void) | undefined;
  let initialGeneration: number | undefined;

  // The call ends with its conversation: archived, or compacted into a new
  // generation whose rows it cannot follow.
  const invalidated = computed(
    () =>
      !!conversation.value?.archived ||
      (initialGeneration !== undefined &&
        conversation.value?.current_generation !== undefined &&
        conversation.value.current_generation !== initialGeneration),
  );

  function sync() {
    const id = conversationId.value;
    if (!id) return;
    const cached = messageStore.peek(id);
    messages.value = cached?.messages ?? [];
    // List patches and the message stream can race; keep the newest row.
    for (const row of [getConversation(id), cached?.conversation]) {
      if (row && (!conversation.value || row.updated_at >= conversation.value.updated_at)) {
        conversation.value = row;
      }
    }
    initialGeneration ??= conversation.value?.current_generation;
  }

  /** Follows conversation id. */
  function bind(id: string, row?: Conversation) {
    release();
    conversationId.value = id;
    conversation.value = row;
    unsubscribe = messageStore.subscribe(id, sync);
    sync();
  }

  function release() {
    unsubscribe?.();
    unsubscribe = undefined;
    conversationId.value = null;
    conversation.value = undefined;
    messages.value = [];
    initialGeneration = undefined;
  }

  // Archiving and renaming arrive as list patches, not through the store.
  watch(() => conversationId.value && getConversation(conversationId.value), sync, {
    flush: "sync",
  });
  onBeforeUnmount(release);
  return { conversationId, conversation, messages, invalidated, bind, release };
}
