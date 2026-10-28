<template>
  <section class="tour-build-activity" data-testid="tour-build-progress">
    <div class="tour-build-heading">
      <h3>{{ status.status === "failed" ? "Tour could not be built" : "Build progress" }}</h3>
      <span v-if="status.worker_conversation_id">Step time</span>
    </div>
    <p v-if="status.status === 'failed'" class="tour-build-error">{{ status.error }}</p>
    <ol
      v-if="status.worker_conversation_id"
      class="tour-build-checklist"
      aria-label="Tour build checklist"
    >
      <li v-for="step in checklist" :key="step.key" :class="step.state">
        <span class="tour-build-step-icon" :aria-label="step.state">
          <span v-if="step.state === 'done'" aria-hidden="true">✓</span>
          <span
            v-else-if="step.state === 'active'"
            class="spinner spinner-small"
            aria-hidden="true"
          />
          <span v-else-if="step.state === 'failed'" aria-hidden="true">×</span>
          <span v-else aria-hidden="true">·</span>
        </span>
        <span>{{ step.label }}</span>
        <RunningToolTime v-if="step.state === 'active'" :start-time="step.startTime">
          <template #default="{ elapsed }">{{ elapsed }}</template>
        </RunningToolTime>
        <time v-else>{{ step.elapsed || "—" }}</time>
      </li>
    </ol>
    <div class="tour-build-footer">
      <button
        v-if="status.status === 'failed' && canRetry"
        type="button"
        class="btn btn-secondary btn-sm"
        @click="emit('retry')"
      >
        Retry
      </button>
      <a v-if="status.worker_slug" :href="`/c/${status.worker_slug}`" target="_blank" rel="noopener"
        >Build details ↗</a
      >
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { GitTourBuildStatus } from "../../services/api";
import RunningToolTime from "./tools/RunningToolTime.vue";
import { elapsedSince } from "./tools/toolElapsed";

const props = defineProps<{ status: GitTourBuildStatus; canRetry: boolean }>();
const emit = defineEmits<{ (e: "retry"): void }>();

// Each step is done once `shelley tour` records any milestone at or past it.
const steps = [
  { key: "survey", label: "Survey changes", doneAt: "survey" },
  { key: "read", label: "Read patches", doneAt: "scaffold" },
  { key: "write", label: "Write walkthrough", doneAt: "verify" },
  { key: "publish", label: "Publish tour", doneAt: "attach" },
];

const checklist = computed(() => {
  const progress = props.status.progress ?? [];
  const startedAt = progress.find((m) => m.step === "start")?.at ?? null;
  const ends: (string | undefined)[] = steps.map(() => undefined);
  for (const milestone of progress) {
    const reached = steps.findIndex((step) => step.doneAt === milestone.step);
    for (let i = 0; i <= reached; i++) ends[i] ??= milestone.at;
  }
  const current = ends.findIndex((end) => !end);
  return steps.map((step, index) => {
    const startTime = index === 0 ? startedAt : (ends[index - 1] ?? null);
    const endTime = ends[index];
    return {
      ...step,
      startTime,
      elapsed: endTime ? elapsedSince(startTime, Date.parse(endTime)) : "",
      state:
        endTime || props.status.status === "present"
          ? "done"
          : index === current
            ? props.status.status === "failed"
              ? "failed"
              : "active"
            : "pending",
    };
  });
});
</script>

<style scoped>
.tour-build-activity {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.5rem 1rem;
}
.tour-build-heading {
  display: flex;
  justify-content: space-between;
  color: var(--text-secondary);
  padding: 0.5rem 0;
}
.tour-build-heading h3 {
  margin: 0;
  font: inherit;
}
.tour-build-checklist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tour-build-checklist li {
  display: grid;
  grid-template-columns: 1rem 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--border);
  color: var(--text-secondary);
}
.tour-build-checklist .active {
  color: var(--text-primary);
}
.tour-build-checklist .pending {
  color: var(--text-tertiary);
}
.tour-build-step-icon {
  display: flex;
}
.tour-build-checklist .done .tour-build-step-icon {
  color: var(--success-text);
}
.tour-build-checklist .failed .tour-build-step-icon {
  color: var(--error-text);
}
.tour-build-checklist time,
.tour-build-checklist :deep(.tool-running-elapsed) {
  margin: 0;
  color: var(--text-tertiary);
  font: inherit;
}
.tour-build-error {
  color: var(--error-text);
}
.tour-build-footer {
  display: flex;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--border);
}
.tour-build-footer:empty {
  display: none;
}
.tour-build-footer a {
  color: var(--text-secondary);
}
</style>
