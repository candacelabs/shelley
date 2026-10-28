<!-- Live status of a narrated diff review. It covers the viewer header's
     selectors while active, so recording costs no vertical space: the
     microphone level and what is being captured (the pointer/selection
     breadcrumb and the text under the pointer), then saving and sending. -->
<template>
  <div
    class="review-recording-status"
    :data-phase="phase"
    role="status"
    :aria-live="phase === 'recording' ? 'off' : 'polite'"
    data-testid="review-recording-status"
    data-review-ignore
  >
    <template v-if="phase === 'recording'">
      <span class="recording-status-dot recording" aria-hidden="true" />
      <div class="recording-waveform" aria-hidden="true">
        <span
          v-for="(level, index) in levels.value"
          :key="index"
          class="recording-waveform-bar"
          :style="{ height: `${Math.max(2, level * 18)}px` }"
        />
      </div>
      <span v-if="current.value.selection" class="review-recording-kind">Selected</span>
      <span class="review-recording-where" data-testid="review-recording-where" :title="where">
        <span v-for="(crumb, index) in crumbs" :key="index" class="review-recording-crumb">{{
          crumb
        }}</span>
      </span>
      <span
        v-if="said"
        class="review-recording-said"
        data-testid="review-recording-said"
        :title="said"
        >{{ said }}</span
      >
    </template>
    <template v-else>
      <span class="recording-status-dot starting" aria-hidden="true" />
      <span class="review-recording-text">{{ phaseText[phase] }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, type Ref } from "vue";
import type { ReviewCaptureState } from "./reviewCapture";
import type { ReviewRecordingPhase } from "./useReviewRecording";

// The live values arrive as refs so meter frames and pointer moves re-render
// only this status; a DiffViewer re-render would drop any open header tooltip.
const props = defineProps<{
  phase: ReviewRecordingPhase;
  levels: Readonly<Ref<number[]>>;
  current: Readonly<Ref<ReviewCaptureState>>;
}>();

const where = computed(() => {
  const current = props.current.value;
  return current.selection || current.pointer || current.screen || current.view || "Recording";
});
const crumbs = computed(() => where.value.split(" › "));
// What is under the pointer, when the pointer is what the status shows.
const said = computed(() => {
  const current = props.current.value;
  return current.selection ? "" : current.pointerText;
});

const phaseText: Record<ReviewRecordingPhase, string> = {
  idle: "",
  recording: "",
  starting: "Waiting for the microphone…",
  stopping: "Saving…",
  sending: "Sending…",
};
</script>
