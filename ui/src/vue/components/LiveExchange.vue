<template>
  <details open class="live-exchange" aria-label="Live exchange" data-testid="live-exchange" @toggle="onToggle">
    <summary aria-label="Live exchange" data-testid="live-exchange-toggle">
      <span class="live-exchange-dot" aria-hidden="true" />
      <strong>Live exchange</strong>
      <button
        v-if="originTitle"
        type="button"
        class="live-exchange-origin"
        :aria-label="`Return to call in ${originTitle}`"
        :title="originTitle"
        @click="$emit('return-to-call')"
      >
        ↩ {{ originTitle }}
      </button>
      <span class="live-exchange-note">Not sent to Shelley</span>
      <button v-if="!following" type="button" class="live-exchange-latest" @click="followLatest">
        Latest ↓
      </button>
    </summary>
    <div
      ref="viewport"
      class="live-exchange-transcript"
      role="region"
      aria-label="Live exchange transcript"
      tabindex="0"
      @scroll="onScroll"
    >
      <div v-for="(turn, index) in turns" :key="index" class="live-exchange-turn">
        <span class="live-exchange-speaker">{{ turn.user ? "You" : "Live" }}</span>
        <p>{{ turn.text }}</p>
      </div>
    </div>
  </details>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { LiveTranscriptTurn } from "../../services/liveTranscript";

const props = defineProps<{ turns: LiveTranscriptTurn[]; originTitle?: string }>();
defineEmits<{ (event: "return-to-call"): void }>();
const viewport = ref<HTMLElement | null>(null);
const following = ref(true);

function onScroll() {
  const el = viewport.value;
  if (el) following.value = el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
}

function followLatest() {
  following.value = true;
  const el = viewport.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function onToggle(event: Event) {
  if ((event.target as HTMLDetailsElement).open && following.value) followLatest();
}

watch(
  () => props.turns,
  async () => {
    await nextTick();
    if (following.value) followLatest();
  },
  { immediate: true },
);
</script>

<style scoped>
.live-exchange {
  border-inline-start: 2px solid var(--green-600);
  padding: 0.5rem 0 0.5rem 0.875rem;
  color: var(--text-secondary);
}
.live-exchange summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  font-size: 0.75rem;
  cursor: pointer;
  list-style: none;
}
.live-exchange summary::-webkit-details-marker {
  display: none;
}
.live-exchange summary::before {
  content: "▸";
}
.live-exchange[open] summary::before {
  content: "▾";
}
.live-exchange:not([open]) summary {
  margin-bottom: 0;
}
.live-exchange summary strong {
  color: var(--text-primary);
  font-weight: 600;
}
.live-exchange-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--green-600);
}
.live-exchange-note {
  margin-inline-start: auto;
  font-size: 0.6875rem;
}
.live-exchange-latest,
.live-exchange-origin {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}
.live-exchange-origin {
  max-width: 12rem;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.live-exchange-transcript {
  max-height: min(12rem, 30dvh);
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.live-exchange-turn {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: 0.75rem;
  margin-top: 0.5rem;
}
.live-exchange-speaker {
  padding-top: 0.125rem;
  font-size: 0.6875rem;
}
.live-exchange-turn p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
