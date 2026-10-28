<!-- Record/stop/cancel controls for narrated diff reviews (useReviewRecording). -->
<template>
  <template v-if="phase === 'recording'">
    <button
      ref="cancelButton"
      v-tooltip.top="discarding ? 'Click again to throw it away' : 'Stop and discard the recording'"
      type="button"
      :class="['review-record-btn', 'review-record-btn-cancel', { armed: discarding }]"
      :aria-label="discarding ? 'Discard recording?' : 'Cancel recording'"
      data-testid="review-record-cancel"
      data-review-ignore
      @click="confirmCancel(true, () => emit('cancel'))"
    >
      {{ discarding ? "Discard?" : "Cancel" }}
    </button>
    <button
      ref="stopButton"
      v-tooltip.top="`Stop and send to ${startsConversation ? 'a new' : 'the'} conversation`"
      type="button"
      class="review-record-btn review-record-btn-stop"
      aria-label="Stop recording"
      data-testid="review-record-stop"
      data-review-ignore
      @click="emit('stop')"
    >
      <svg fill="currentColor" viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="2" />
      </svg>
      <ReviewRecordingElapsed :ms="elapsedMs" />
    </button>
  </template>
  <button
    v-else
    ref="startButton"
    v-tooltip.top="`Record a narrated review${startsConversation ? ' for a new conversation' : ''}`"
    type="button"
    class="review-record-btn"
    :disabled="phase !== 'idle'"
    :aria-busy="phase !== 'idle'"
    aria-label="Record review"
    data-testid="review-record-start"
    @click="emit('start')"
  >
    <svg
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path stroke-linecap="round" stroke-linejoin="round" d="m16 10 5-3v10l-5-3z" />
    </svg>
  </button>
</template>

<script setup lang="ts">
import { nextTick, ref, watch, type Ref } from "vue";
import { useConfirmTwice } from "../composables/confirmTwice";
import type { ReviewRecordingPhase } from "./useReviewRecording";
import ReviewRecordingElapsed from "./ReviewRecordingElapsed.vue";

// elapsedMs is the ref itself so each tick re-renders only the time; a
// re-render here or in DiffViewer would drop open tooltips (see DiffViewer).
const props = defineProps<{
  phase: ReviewRecordingPhase;
  elapsedMs: Readonly<Ref<number>>;
  // Outside a conversation, the recording starts one.
  startsConversation: boolean;
}>();
const emit = defineEmits<{ (e: "start"): void; (e: "stop"): void; (e: "cancel"): void }>();

const { armed: discarding, click: confirmCancel, reset } = useConfirmTwice<boolean>();

const cancelButton = ref<HTMLButtonElement | null>(null);
const stopButton = ref<HTMLButtonElement | null>(null);
const startButton = ref<HTMLButtonElement | null>(null);
// Stop and Cancel leave with the recording; keyboard focus returns to start.
let refocus = false;
watch(
  () => props.phase,
  (phase, previous) => {
    reset();
    if (previous === "recording") {
      const focused = document.activeElement;
      refocus = focused === cancelButton.value || focused === stopButton.value;
    }
    if (phase !== "idle" || !refocus) return;
    refocus = false;
    void nextTick(() => {
      if (document.activeElement === document.body) startButton.value?.focus();
    });
  },
);
</script>
