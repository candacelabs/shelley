<!-- Link to the conversation a message came from, labelled with its current
     slug. Names arrive asynchronously and can change; the href always uses the
     stable conversation ID. -->
<template>
  <a
    :href="`/c/${encodeURIComponent(source.conversationId)}`"
    :title="
      source.relationship === 'parent' ? 'Open parent conversation' : 'Open subagent conversation'
    "
    @click="open"
    >{{ slug }}</a
  >
</template>

<script setup lang="ts">
import { computed, inject } from "vue";
import type { ConversationMessageSource } from "../../utils/messageSource";
import { ConversationsListKey, navigateToConversationSlug } from "../composables/subagentLive";

const props = defineProps<{ source: ConversationMessageSource }>();
const conversations = inject(ConversationsListKey, null);
const slug = computed(() => {
  const source = props.source;
  const sender = conversations?.value.find((c) => c.conversation_id === source.conversationId);
  return sender?.slug || source.slug || source.conversationId;
});

function open(event: MouseEvent) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
    return;
  event.preventDefault();
  navigateToConversationSlug(encodeURIComponent(props.source.conversationId));
}
</script>
