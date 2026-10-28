<!-- Vue port of components/SubagentTool.tsx.
     Preserves: .tool, .tool-header, .tool-summary, .tool-emoji ⚡,
     .tool-badge, .subagent-model-badge, .tool-command, .tool-toggle, .tool-details, .tool-section,
     .tool-label, .tool-code, .tool-time, .subagent-link,
     data-testid tool-call-running/completed.

     Header: the subagent's slug, its model as a muted tag, and the first line
     of the prompt, laid out like the bash card's command line.

     Live view: while the subagent is working (per the conversation list's
     authoritative working flag, injected from App via subagentLive), a strip
     under the header shows what it's doing right now — streaming text tail,
     running tool headline, or last-message preview — sourced from the same
     /api/stream2 events the rest of the UI already receives. Clicking the
     strip opens the subagent conversation.

     Subagent navigation: the React original navigates client-side by pushing
     `/c/{slug}` onto window.history and dispatching a popstate event (no parent
     callback prop). This port replicates that behavior verbatim in onLinkClick;
     it does not introduce a new prop or emit. -->
<template>
  <div class="tool" :data-testid="isComplete ? 'tool-call-completed' : 'tool-call-running'">
    <div class="tool-header" @click="isExpanded = !isExpanded">
      <div class="tool-summary">
        <span class="tool-emoji" :class="{ running: isRunning }">⚡</span>
        <span class="tool-command subagent-tool-slug">{{ slug }}</span>
        <span v-if="model" class="tool-tag">{{ model }}</span>
        <span class="tool-command">{{ firstLine }}</span>
      </div>
      <button
        class="tool-toggle"
        :aria-label="isExpanded ? 'Collapse' : 'Expand'"
        :aria-expanded="isExpanded"
      >
        <ToolChevron :expanded="isExpanded" />
      </button>
    </div>

    <SubagentLiveStrip v-if="showLive" :slug="liveSlug" :activity="activity" />

    <div v-if="isExpanded" class="tool-details">
      <RunningToolTime v-if="isRunning" :start-time="toolInvokedAt" />
      <div class="tool-section">
        <div class="tool-label">
          Prompt to '{{ slug }}':
          <span v-if="model" class="tool-badge subagent-model-badge">{{ model }}</span>
        </div>
        <div class="tool-code">{{ prompt || "(no prompt)" }}</div>
      </div>

      <div v-if="isComplete" class="tool-section">
        <div class="tool-label">
          Response{{ hasError ? " (Error)" : "" }}:
          <span v-if="executionTime" class="tool-time">{{ executionTime }}</span>
        </div>
        <div :class="`tool-code ${hasError ? 'error' : ''}`">
          {{ resultText || "(no response)" }}
        </div>
      </div>

      <div v-if="displayData?.conversation_id" class="tool-section">
        <div class="tool-label">Conversation:</div>
        <div class="tool-code">
          <a :href="`/c/${liveSlug}`" class="subagent-link" @click="onLinkClick">
            View subagent conversation →
          </a>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { LLMContent } from "../../../types";
import { useSubagentLive, navigateToConversationSlug } from "../../composables/subagentLive";
import SubagentLiveStrip from "../SubagentLiveStrip.vue";
import ToolChevron from "./ToolChevron.vue";
import RunningToolTime from "./RunningToolTime.vue";

interface SubagentInput {
  slug?: string;
  prompt?: string;
  model?: string;
}

const props = defineProps<{
  toolInput?: unknown;
  isRunning?: boolean;
  toolInvokedAt?: string | null;
  toolResult?: LLMContent[];
  hasError?: boolean;
  executionTime?: string;
  displayData?: { slug?: string; conversation_id?: string; status?: string };
}>();

const isExpanded = ref(false);

const input = computed<SubagentInput>(() =>
  typeof props.toolInput === "object" && props.toolInput !== null
    ? (props.toolInput as SubagentInput)
    : {},
);

// Prefer the display data's slug: the server may have suffixed the requested
// slug for uniqueness, and displayData carries the actual one.
const slug = computed(() => props.displayData?.slug || input.value.slug || "subagent");
const prompt = computed(() => input.value.prompt || "");
const model = computed(() => input.value.model || "");

// Live subagent state (working flag + current activity), joined from the
// conversation list + messageStore via the injected app context.
const { conv, working, activity } = useSubagentLive(
  slug,
  computed(() => props.displayData?.conversation_id),
);
// The subagent keeps working after this tool call completes (the call only
// acknowledges dispatch), so the strip keys off the conversation's working flag, not the tool-call state.
const showLive = computed(() => working.value || (!!props.isRunning && !!conv.value));
const liveSlug = computed(() => conv.value?.slug || slug.value);

// Extract result text
const resultText = computed(
  () =>
    props.toolResult
      ?.filter((r) => r.Type === 2) // ContentTypeText
      .map((r) => r.Text)
      .join("\n") || "",
);

const firstLine = computed(() => prompt.value.trim().split(/\r?\n/)[0]);
const isComplete = computed(() => !props.isRunning && props.toolResult !== undefined);

function onLinkClick(e: MouseEvent) {
  // Let the browser handle cmd/ctrl/shift/middle-click (open in new tab/window).
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  // Navigate to the subagent conversation
  navigateToConversationSlug(liveSlug.value);
}
</script>

<style scoped>
.subagent-tool-slug {
  flex-shrink: 0;
  max-width: 40%;
}
</style>
