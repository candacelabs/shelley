<!-- Specialized card for synthetic openai_audio_transcription audit entries. -->
<template>
  <div class="tool audio-transcription-tool" data-testid="tool-call-completed">
    <div class="tool-header" @click="isExpanded = !isExpanded">
      <div class="tool-summary">
        <span class="tool-emoji">🎙️</span>
        <span class="audio-transcription-copy">
          <span class="audio-transcription-title-row">
            <span class="audio-transcription-title">Audio transcription</span>
            <span v-if="model" class="tool-badge">{{ model }}</span>
          </span>
          <span class="audio-transcription-filename" :title="filePath || undefined">
            {{ filename || "Recording" }}
          </span>
        </span>
      </div>
      <div class="audio-transcription-controls">
        <span v-if="hasErrorResult" class="audio-transcription-error-status">failed</span>
        <span v-if="executionTime" class="tool-time">{{ executionTime }}</span>
        <button
          class="tool-toggle"
          :aria-label="isExpanded ? 'Collapse' : 'Expand'"
          :aria-expanded="isExpanded"
        >
          <ToolChevron :expanded="isExpanded" />
        </button>
      </div>
    </div>

    <div v-if="isExpanded" class="tool-details">
      <RunningToolTime v-if="isRunning" :start-time="toolInvokedAt" />
      <div v-if="filePath" class="tool-section">
        <div class="tool-label">Recording:</div>
        <div class="tool-code">{{ filePath }}</div>
      </div>

      <div v-if="promptCharacters" class="tool-section">
        <div class="tool-label">Context:</div>
        <div class="audio-transcription-request">
          <span class="tool-badge">{{ promptCharacters }}</span>
        </div>
      </div>

      <div v-if="resultText" class="tool-section">
        <div class="tool-label">{{ hasErrorResult ? "Error:" : "Transcript:" }}</div>
        <div
          :class="[
            'audio-transcription-transcript',
            { 'audio-transcription-transcript--error': hasErrorResult },
          ]"
        >
          {{ resultText }}
        </div>
      </div>

      <div v-if="timestampModel || timestampsPath" class="tool-section">
        <div class="tool-label">Timestamps:</div>
        <div v-if="timestampModel" class="audio-transcription-request">
          <span class="tool-badge">{{ timestampModel }}</span>
        </div>
        <div v-if="timestampsPath" class="tool-code">{{ timestampsPath }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { LLMContent } from "../../../types";
import ToolChevron from "./ToolChevron.vue";
import RunningToolTime from "./RunningToolTime.vue";

interface AudioTranscriptionInput {
  file?: string;
  model?: string;
  prompt_chars?: number;
}

interface AudioTranscriptionOutput {
  error?: string;
  model?: string;
  text?: string;
  timestamps_model?: string;
  timestamps_path?: string;
}

const props = defineProps<{
  toolInput?: unknown;
  isRunning?: boolean;
  toolInvokedAt?: string | null;
  toolResult?: LLMContent[];
  hasError?: boolean;
  executionTime?: string;
  display?: unknown;
}>();

const isExpanded = ref(false);

const input = computed<AudioTranscriptionInput>(() =>
  isRecord(props.toolInput) ? (props.toolInput as AudioTranscriptionInput) : {},
);

const rawOutput = computed(
  () =>
    props.toolResult
      ?.filter((result) => result.Type === 2 && result.Text)
      .map((result) => result.Text)
      .join("\n") || "",
);

const output = computed<AudioTranscriptionOutput>(() => {
  if (!rawOutput.value) return {};
  try {
    const parsed: unknown = JSON.parse(rawOutput.value);
    return isRecord(parsed) ? (parsed as AudioTranscriptionOutput) : { text: rawOutput.value };
  } catch {
    return { text: rawOutput.value };
  }
});

const filePath = computed(() => stringValue(input.value.file));
const filename = computed(() => filePath.value.split(/[\\/]/).pop() || filePath.value);
const model = computed(() => stringValue(output.value.model) || stringValue(input.value.model));
const resultText = computed(
  () => stringValue(output.value.text) || stringValue(output.value.error),
);
const hasErrorResult = computed(() => Boolean(props.hasError || output.value.error));
const timestampModel = computed(() => stringValue(output.value.timestamps_model));
const timestampsPath = computed(() => stringValue(output.value.timestamps_path));
const promptCharacters = computed(() => {
  const count = input.value.prompt_chars;
  if (typeof count !== "number" || !Number.isFinite(count) || count < 0) return "";
  return `${Math.round(count).toLocaleString()} prompt characters`;
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
</script>
