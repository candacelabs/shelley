<!-- message_parent: a subagent's message to its parent conversation. The
     parent shows the delivered text as a "Message from <slug>" user bubble;
     this is the sender's side. -->
<template>
  <div class="tool" :data-testid="isComplete ? 'tool-call-completed' : 'tool-call-running'">
    <div class="tool-header" @click="isExpanded = !isExpanded">
      <div class="tool-summary">
        <span class="tool-emoji" :class="{ running: isRunning }">💬</span>
        <span class="tool-command">→ parent: {{ firstLine || "..." }}</span>
        <span v-if="endTurn" class="tool-command">(final)</span>
      </div>
      <button
        class="tool-toggle"
        :aria-label="isExpanded ? 'Collapse' : 'Expand'"
        :aria-expanded="isExpanded"
      >
        <ToolChevron :expanded="isExpanded" />
      </button>
    </div>

    <div v-if="isExpanded" class="tool-details">
      <RunningToolTime v-if="isRunning" :start-time="toolInvokedAt" />
      <div class="tool-section">
        <div class="tool-label">
          {{ messageLabel }}:
          <span v-if="executionTime" class="tool-time">{{ executionTime }}</span>
        </div>
        <div class="tool-code">{{ text || "(empty)" }}</div>
      </div>
      <div v-if="isComplete && hasError" class="tool-section">
        <div class="tool-label">Error:</div>
        <div class="tool-code error">{{ resultText }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { LLMContent } from "../../../types";
import ToolChevron from "./ToolChevron.vue";
import RunningToolTime from "./RunningToolTime.vue";

const props = defineProps<{
  toolInput?: unknown;
  isRunning?: boolean;
  toolInvokedAt?: string | null;
  toolResult?: LLMContent[];
  hasError?: boolean;
  executionTime?: string;
}>();

const isExpanded = ref(false);

const text = computed(() => {
  const ti = props.toolInput;
  if (typeof ti === "object" && ti !== null && "text" in ti) {
    const v = (ti as { text: unknown }).text;
    if (typeof v === "string") return v;
  }
  return "";
});

const firstLine = computed(() => text.value.trim().split(/\r?\n/)[0] ?? "");
const endTurnValue = computed(() => {
  const ti = props.toolInput;
  if (typeof ti !== "object" || ti === null || !("end_turn" in ti)) return null;
  return typeof ti.end_turn === "boolean" ? ti.end_turn : null;
});
const endTurn = computed(() => endTurnValue.value === true);
const messageLabel = computed(() =>
  endTurnValue.value === null
    ? "Message"
    : endTurn.value
      ? "Final report (ends turn)"
      : "Progress message",
);

const resultText = computed(
  () =>
    props.toolResult
      ?.map((r) => r.Text)
      .filter(Boolean)
      .join("") || "",
);

const isComplete = computed(() => !props.isRunning && props.toolResult !== undefined);
</script>
