// Reactive conversation visibility setting shared by the menu and chat renderer.
// Conversations with the message_user tool keep a separate setting: their
// choices are "all" and "brief" (the chat only), and they default to brief.
import { computed, ref, type Ref } from "vue";
import {
  getConversationViewMode,
  getMessageUserViewMode,
  setConversationViewMode as persist,
  setMessageUserViewMode as persistMessageUser,
  type ConversationViewMode,
  type MessageUserViewMode,
} from "../../services/settings";

const mode = ref(getConversationViewMode());
const messageUserMode = ref<MessageUserViewMode>(getMessageUserViewMode());

/** messageUser: whether the open conversation has the message_user tool. */
export function useConversationView(messageUser: Ref<boolean>) {
  return {
    conversationViewMode: computed<ConversationViewMode>(() =>
      messageUser.value ? messageUserMode.value : mode.value,
    ),
    setConversationViewMode(next: ConversationViewMode) {
      if (messageUser.value) {
        if (next === "end-of-turn") return;
        persistMessageUser(next);
        messageUserMode.value = next;
      } else {
        if (next === "brief") return;
        persist(next);
        mode.value = next;
      }
    },
  };
}

export type { ConversationViewMode };
