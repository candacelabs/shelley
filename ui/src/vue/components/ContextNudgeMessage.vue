<!-- Context-size nudge, with the index sent to the agent behind one status row. -->
<template>
  <details class="msg-compaction-event" data-testid="message-context-nudge">
    <summary class="message message-gitinfo msg-distill-container msg-compaction-event-header">
      <span aria-hidden="true">📏</span>
      <span class="msg-compaction-event-label">
        Compaction threshold reached · {{ contextSize }} tokens
      </span>
      <ToolChevron :expanded="false" />
    </summary>
    <div v-if="nudge.index" class="msg-compaction-event-body">
      <div class="tool-label">Index sent to the agent</div>
      <pre class="msg-context-nudge-index">{{ nudge.index }}</pre>
    </div>
  </details>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Message as MessageType } from "../../types";
import { contextNudge } from "../../types";
import ToolChevron from "./tools/ToolChevron.vue";

const props = defineProps<{ message: MessageType }>();

const nudge = computed(() => contextNudge(props.message) ?? { size: "", index: "" });
const contextSize = computed(() => nudge.value.size.replace(/^Context is (.+)\.$/, "$1"));
</script>
