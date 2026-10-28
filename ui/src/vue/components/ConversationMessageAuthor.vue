<template>
  <div
    v-if="'backgroundJobId' in source"
    class="message-author-conversation"
    data-testid="message-author-background-job"
  >
    Background job {{ source.backgroundJobId }}
  </div>
  <div v-else class="message-author-conversation" data-testid="message-author-conversation">
    Message from <ConversationSourceLink :source="source" />
  </div>
</template>

<script setup lang="ts">
import type { MessageSource } from "../../utils/messageSource";
import ConversationSourceLink from "./ConversationSourceLink.vue";

defineProps<{ source: MessageSource }>();
</script>
