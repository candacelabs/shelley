<template>
  <div
    :class="['message message-tool transcription-task', { 'message-conversation': !!source }]"
    data-testid="transcription-task"
  >
    <div class="message-content">
      <ConversationMessageAuthor v-if="source" :source="source" />
      <div :class="['transcription-task-card', { error: state === 'failed' }]">
        <div class="transcription-task-main">
          <div v-if="state === 'working'" class="spinner spinner-small" aria-hidden="true" />
          <svg
            v-else
            class="transcription-task-icon"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path stroke-linecap="round" d="m9 9 6 6m0-6-6 6" />
          </svg>
          <div class="transcription-task-copy">
            <strong>{{
              state === "working" ? t("recordingTranscribing") : t("recordingFailed")
            }}</strong>
            <span v-if="context" class="transcription-task-context" :title="context">{{
              context
            }}</span>
            <span class="transcription-task-path" :title="path">{{ filename }}</span>
            <span v-if="error" class="transcription-task-error" role="alert">{{ error }}</span>
          </div>
        </div>
        <div class="transcription-task-actions">
          <button
            v-if="state === 'working'"
            type="button"
            class="btn btn-secondary"
            data-testid="transcription-stop-button"
            @click="$emit('stop')"
          >
            {{ t("recordingStopTranscription") }}
          </button>
          <template v-else>
            <button
              type="button"
              class="btn btn-primary"
              data-testid="transcription-retry-button"
              @click="$emit('retry')"
            >
              {{ t("retry") }}
            </button>
            <button
              type="button"
              class="btn btn-secondary"
              data-testid="transcription-cancel-button"
              @click="$emit('cancel')"
            >
              {{ t("cancel") }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { messageSource } from "../../utils/messageSource";
import ConversationMessageAuthor from "./ConversationMessageAuthor.vue";
import { useI18n } from "../composables/i18n";

const props = defineProps<{
  path: string;
  state: "working" | "failed";
  error?: string;
  context?: string;
  userData?: unknown;
}>();

defineEmits<{
  (e: "stop"): void;
  (e: "retry"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const source = computed(() => messageSource(props.userData));
const filename = computed(() => props.path.split("/").pop() || props.path);
</script>
