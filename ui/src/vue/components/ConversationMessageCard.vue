<!-- A message delivered from another conversation (a subagent's message_parent,
     or a parent's message to its subagent), rendered as a tool card: the
     sender's slug, a tag ("from parent", or "message" from a subagent), and
     the first line. A message that fits on one short line shows in full in
     the header; longer ones expand into the verbatim text, shown like other
     tool cards' details, with URLs linked. -->
<template>
  <div class="tool" data-testid="conversation-message-card">
    <div
      :class="['tool-header', { 'tool-header--static': !expandable }]"
      @click="expandable && (isExpanded = !isExpanded)"
    >
      <div class="tool-summary conversation-message-card-summary">
        <span class="tool-emoji">⚡</span>
        <div class="conversation-message-card-line">
          <span class="tool-command conversation-message-card-slug" @click.stop>
            <ConversationSourceLink :source="source" />
          </span>
          <span class="tool-tag">{{ tag }}</span>
          <span
            :class="[
              'tool-command',
              'conversation-message-card-headline',
              { 'conversation-message-card-full': !expandable },
            ]"
            data-testid="conversation-message-card-headline"
            >{{ firstLine }}</span
          >
        </div>
      </div>
      <button
        v-if="expandable"
        class="tool-toggle"
        :aria-label="isExpanded ? 'Collapse' : 'Expand'"
        :aria-expanded="isExpanded"
      >
        <ToolChevron :expanded="isExpanded" />
      </button>
    </div>
    <div v-if="isExpanded" class="tool-details">
      <div class="tool-section">
        <div class="tool-label">Message:</div>
        <div class="tool-code">
          <template v-for="(part, i) in bodyParts" :key="i">
            <a
              v-if="part.type === 'link'"
              :href="part.href"
              target="_blank"
              rel="noopener noreferrer"
              class="text-link"
              >{{ part.content }}</a
            >
            <template v-else>{{ part.content }}</template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { localhostLinkOptionsFromInit, parseLinks } from "../../utils/linkify";
import type { ConversationMessageSource } from "../../utils/messageSource";
import ConversationSourceLink from "./ConversationSourceLink.vue";
import ToolChevron from "./tools/ToolChevron.vue";

const props = defineProps<{
  source: ConversationMessageSource;
  text: string;
}>();

/** Longest single-line message shown in full in the header. */
const HEADLINE_MAX = 80;

const tag = computed(() => (props.source.relationship === "parent" ? "from parent" : "message"));
const isExpanded = ref(false);
const trimmed = computed(() => props.text.trim());
const firstLine = computed(() => trimmed.value.split(/\r?\n/)[0]);
const bodyParts = computed(() => parseLinks(props.text, localhostLinkOptionsFromInit()));
const expandable = computed(
  () => firstLine.value !== trimmed.value || trimmed.value.length > HEADLINE_MAX,
);
</script>

<style scoped>
/* The emoji sits on the first line when the message wraps below. */
.conversation-message-card-summary {
  align-items: baseline;
}
/* Sender, tag and message flow like a sentence: where the message would get
   less than its basis beside the sender, and always on phones, it takes its
   own line, under the sender rather than squeezed into a column next to it. */
.conversation-message-card-line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.5rem;
  flex: 1;
  min-width: 0;
}
.conversation-message-card-slug {
  flex-shrink: 0;
  max-width: 40%;
}
.conversation-message-card-headline {
  flex: 1 1 12rem;
  min-width: 0;
}
@media (max-width: 640px) {
  .conversation-message-card-headline {
    flex-basis: 100%;
  }
}
/* Styled like the subagent card's slug; the link shows only on hover. */
.conversation-message-card-slug a {
  color: inherit;
  text-decoration: none;
}
.conversation-message-card-slug a:hover {
  text-decoration: underline;
}
/* Nothing to expand: wrap rather than hide the end of the message. */
.conversation-message-card-full {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
