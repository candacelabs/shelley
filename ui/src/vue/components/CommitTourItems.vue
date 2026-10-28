<!-- A tour's key design decisions or questions for the reader: a numbered
     list of titled items, each with an optional markdown body. Each item has
     a comment action whose text lands in the message input like any other
     tour comment, so answering a question is just commenting on it. -->
<template>
  <section
    class="commit-tour-items"
    :class="`commit-tour-items-${kind}`"
    :data-review="heading"
    data-review-item
  >
    <h2 class="commit-tour-items-heading">{{ heading }}</h2>
    <ol class="commit-tour-item-list">
      <li
        v-for="(item, index) in items"
        :key="index"
        class="commit-tour-item"
        :data-review="`${kind === 'question' ? 'Question' : 'Decision'} ${index + 1}`"
      >
        <div class="commit-tour-item-head">
          <span class="commit-tour-item-number" aria-hidden="true">{{ index + 1 }}</span>
          <MarkdownContent class="commit-tour-item-title" :text="item.title" />
          <button
            v-tooltip.top="
              kind === 'question' ? 'Answer this question' : 'Comment on this decision'
            "
            type="button"
            class="commit-tour-item-action"
            :aria-label="`${kind === 'question' ? 'Answer question' : 'Comment on decision'} ${index + 1}`"
            @click="emit('comment', item, index)"
          >
            💬<span v-if="kind === 'question'">Answer</span>
          </button>
        </div>
        <MarkdownContent v-if="item.body" class="commit-tour-item-body" :text="item.body" />
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { GitTourItem } from "../../services/api";
import MarkdownContent from "./MarkdownContent.vue";

const props = defineProps<{
  kind: "decision" | "question";
  items: GitTourItem[];
}>();
const emit = defineEmits<{
  (e: "comment", item: GitTourItem, index: number): void;
}>();

const heading = computed(() =>
  props.kind === "question" ? "Questions for you" : "Key design decisions",
);
</script>

<style scoped>
.commit-tour-items {
  min-width: 0;
  scroll-margin-top: 1rem;
  overflow-wrap: anywhere;
}

.commit-tour-items-heading {
  margin: 0 0 0.625rem;
  font-size: 1.125rem;
  line-height: 1.3;
}

.commit-tour-item-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.commit-tour-item {
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-secondary);
}

.commit-tour-items-question .commit-tour-item {
  border-color: color-mix(in srgb, var(--border-color) 60%, var(--accent-color, #3b82f6));
}

.commit-tour-item-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.commit-tour-item-number {
  flex: 0 0 auto;
  min-width: 1.25rem;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 0.8125rem;
  font-weight: 600;
}

.commit-tour-item-title {
  min-width: 0;
  flex: 1 1 auto;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
}

/* Titles are one line of inline markdown; drop the paragraph spacing. */
.commit-tour-item-title :deep(p) {
  margin: 0;
}

.commit-tour-item-action {
  flex: 0 0 auto;
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.45rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}

.commit-tour-items-decision .commit-tour-item-action {
  opacity: 0;
}

.commit-tour-item:hover .commit-tour-item-action,
.commit-tour-item-action:focus-visible {
  opacity: 1;
}

.commit-tour-items-question .commit-tour-item-action {
  border-color: var(--border-color);
  background: var(--bg-base);
}

.commit-tour-item-action:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.commit-tour-item-body {
  margin: 0.375rem 0 0 1.75rem;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.commit-tour-item-body :deep(> :first-child) {
  margin-top: 0;
}

.commit-tour-item-body :deep(> :last-child) {
  margin-bottom: 0;
}

@media (hover: none) {
  .commit-tour-items-decision .commit-tour-item-action {
    opacity: 1;
  }
}

@media (max-width: 767px) {
  .commit-tour-items {
    margin-right: 0.875rem;
    margin-left: 0.875rem;
  }

  .commit-tour-item-body {
    margin-left: 0;
  }
}
</style>
