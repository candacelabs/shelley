<template>
  <section v-if="count > 0 || open" class="running-work" aria-label="Running work">
    <button
      type="button"
      class="running-work-toggle"
      data-testid="running-work-toggle"
      :aria-expanded="open"
      :aria-controls="`running-work-${conversationId}`"
      @click="toggleWork"
    >
      <span v-if="count > 0" class="running-work-dot" aria-hidden="true" />
      <span ref="summary" class="running-work-summary">
        <span v-if="!open && names.length" class="running-work-names">
          <template v-for="(name, index) in names" :key="index">
            <span v-if="index > 0" class="running-work-separator">,</span>
            <span class="running-work-name" :class="{ command: name.command }">
              {{ name.text }}
            </span>
          </template>
          <span v-if="count > names.length" class="running-work-more">
            and {{ count - names.length }} more
          </span>
        </span>
        <span v-else class="running-work-count">{{ counts }}</span>
        <span v-if="!open && names.length" class="running-work-activity">
          {{ singleJob ? lastOutput : singleSubagent ? agentActivity || "Working…" : counts }}
        </span>
        <span v-if="!open && previewError" class="running-work-activity" role="alert">
          {{ previewError }}
        </span>
        <span v-if="!open" ref="measurements" class="running-work-measurements" aria-hidden="true">
          <span
            v-for="(name, index) in allNames"
            :key="index"
            class="running-work-probe"
            :class="{ command: name.command }"
            >{{ name.text }}</span
          >
          <span class="running-work-separator-probe">,</span>
          <span class="running-work-more-probe">and {{ count }} more</span>
        </span>
      </span>
      <span class="running-work-view">
        <RunningToolTime v-if="!open && startedAt" v-slot="{ elapsed }" :start-time="startedAt">
          {{ elapsed }}
        </RunningToolTime>
        <span v-if="open">Hide work</span>
        <ToolChevron :expanded="open" />
      </span>
    </button>
    <div
      v-if="open"
      :id="`running-work-${conversationId}`"
      class="running-work-items"
      data-testid="running-work-items"
      role="region"
      aria-label="Running work details"
    >
      <RunningWorkAgent
        v-for="sub in seenSubagents"
        :key="sub.conversation_id"
        :conversation="sub"
        :finished="!runningSubagentIds.has(sub.conversation_id)"
      />
      <BackgroundJobsList v-if="ownJobCount > 0 || seenJobs.length > 0" :jobs="seenJobs" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import type { ConversationWithState } from "../../types";
import type { BackgroundJob } from "../../services/api";
import { runningSubagents } from "../../utils/runningSubagents";
import { BackgroundJobsKey } from "../composables/backgroundJobs";
import { ConversationsListKey, useSubagentLive } from "../composables/subagentLive";
import { useSubagentJobPreviews } from "../composables/subagentJobPreviews";
import BackgroundJobsList from "./BackgroundJobsList.vue";
import RunningWorkAgent from "./RunningWorkAgent.vue";
import ToolChevron from "./tools/ToolChevron.vue";
import RunningToolTime from "./tools/RunningToolTime.vue";

const props = defineProps<{ conversationId: string }>();
const emit = defineEmits<{ toggle: [] }>();

const conversations = inject(ConversationsListKey);
if (!conversations) throw new Error("RunningWorkStrip requires ConversationsListKey");
const backgroundJobs = inject(BackgroundJobsKey);
if (!backgroundJobs) throw new Error("RunningWorkStrip requires BackgroundJobsKey");

const open = ref(false);
const seenSubagents = shallowRef<ConversationWithState[]>([]);
const seenJobs = shallowRef<BackgroundJob[]>([]);

const ownJobCount = computed(
  () =>
    conversations.value.find((c) => c.conversation_id === props.conversationId)
      ?.running_background_jobs ?? 0,
);
const subagents = computed(() => runningSubagents(conversations.value, props.conversationId));
const { jobs: subagentJobs, error: previewError } = useSubagentJobPreviews(
  subagents,
  computed(() => !open.value),
);
const jobCount = computed(
  () =>
    ownJobCount.value + subagents.value.reduce((sum, sub) => sum + sub.running_background_jobs, 0),
);
const runningSubagentIds = computed(
  () => new Set(subagents.value.map((sub) => sub.conversation_id)),
);

const count = computed(() => jobCount.value + subagents.value.length);

const counts = computed(() => {
  const parts = [];
  if (jobCount.value) parts.push(`${jobCount.value} task${jobCount.value === 1 ? "" : "s"}`);
  if (subagents.value.length) {
    parts.push(`${subagents.value.length} subagent${subagents.value.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ") || "No running work";
});
const singleJob = computed(() =>
  count.value === 1 && jobCount.value === 1 ? backgroundJobs.jobs.value?.[0] : undefined,
);
const singleSubagent = computed(() => (count.value === 1 ? subagents.value[0] : undefined));
const { activity: agentActivity, startedAt: agentStartedAt } = useSubagentLive(
  computed(() => singleSubagent.value?.slug ?? ""),
  computed(() => singleSubagent.value?.conversation_id),
);
const startedAt = computed(() => singleJob.value?.started_at ?? agentStartedAt.value);
const lastOutput = computed(
  () => singleJob.value?.tail.trim().split("\n").slice(-1)[0] || "No output yet.",
);
function jobNames(jobs: BackgroundJob[] | null | undefined, count: number) {
  if (count === 0) return [];
  if (!jobs) {
    return Array.from({ length: count }, () => ({ text: "Loading task…", command: true }));
  }
  return jobs.map((job) => {
    const command = job.command.trim();
    return {
      text: command.split("\n")[0] + (command.includes("\n") ? " …" : ""),
      command: true,
    };
  });
}
const allNames = computed(() =>
  [
    ...subagents.value.map((sub) => ({ text: sub.slug, command: false })),
    ...subagents.value.flatMap((sub) =>
      jobNames(subagentJobs.value.get(sub.conversation_id), sub.running_background_jobs),
    ),
    ...jobNames(backgroundJobs.jobs.value, ownJobCount.value),
  ].slice(0, count.value),
);
const summary = ref<HTMLElement | null>(null);
const measurements = ref<HTMLElement | null>(null);
const visibleCount = ref(1);
const names = computed(() => allNames.value.slice(0, visibleCount.value));

function fitNames() {
  const row = measurements.value;
  const available = summary.value?.clientWidth;
  if (!row || !available) return;
  const gap = parseFloat(getComputedStyle(row).columnGap);
  const separator = row.querySelector<HTMLElement>(".running-work-separator-probe")!;
  const between =
    separator.getBoundingClientRect().width +
    2 * gap +
    parseFloat(getComputedStyle(separator).marginLeft);
  const more = row.querySelector<HTMLElement>(".running-work-more-probe")!;
  const moreWidth = more.getBoundingClientRect().width + gap;
  let used = 0;
  let visible = 1;
  row.querySelectorAll<HTMLElement>(".running-work-probe").forEach((item, index) => {
    used += item.getBoundingClientRect().width + (index > 0 ? between : 0);
    const suffix = count.value > index + 1 ? moreWidth : 0;
    if (used + suffix <= available) visible = index + 1;
  });
  visibleCount.value = visible;
}

watch([() => JSON.stringify([count.value, allNames.value]), open], fitNames, {
  flush: "post",
});
let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  resizeObserver = new ResizeObserver(fitNames);
  watch(
    summary,
    (element) => {
      resizeObserver!.disconnect();
      if (element) resizeObserver!.observe(element);
      fitNames();
    },
    { immediate: true, flush: "post" },
  );
  void document.fonts.ready.then(fitNames);
});
onUnmounted(() => resizeObserver?.disconnect());

function toggleWork() {
  open.value = !open.value;
  emit("toggle");
}

function remember<T>(seen: T[], current: T[], key: (item: T) => string): T[] {
  const items = new Map<string, T>();
  for (const item of [...seen, ...current]) items.set(key(item), item);
  return [...items.values()];
}

watch([open, subagents, backgroundJobs.jobs], ([expanded, agents, jobs]) => {
  if (!expanded) {
    seenSubagents.value = [];
    seenJobs.value = [];
    return;
  }
  seenSubagents.value = remember(seenSubagents.value, agents, (sub) => sub.conversation_id).sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) ||
      a.conversation_id.localeCompare(b.conversation_id),
  );
  if (jobs !== null) {
    seenJobs.value = remember(seenJobs.value, jobs, (job) => job.job_id);
  }
});
</script>

<style scoped>
.running-work {
  flex: 0 0 auto;
  margin: 12px 0 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-secondary);
  font-size: var(--font-size-13);
}

.running-work-toggle {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 11px 14px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.running-work-toggle:hover {
  background: var(--bg-tertiary);
}

.running-work-summary {
  position: relative;
  flex: 1;
  min-width: 0;
}

.running-work-names,
.running-work-measurements {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.running-work-name,
.running-work-probe {
  min-width: 0;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.running-work-name.command,
.running-work-probe.command {
  flex: 1;
  max-width: 40ch;
  font-family: var(--font-mono);
  font-size: var(--font-size-12);
}

.running-work-name:not(.command):only-child {
  max-width: 100%;
}

.running-work-measurements {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}

.running-work-probe,
.running-work-more-probe {
  flex: none;
}

.running-work-probe.command {
  flex: none;
  max-width: 12ch;
}

.running-work-activity {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: var(--font-size-12);
}

.running-work-more {
  flex-shrink: 0;
}

.running-work-separator,
.running-work-separator-probe {
  flex-shrink: 0;
  margin-left: -4px;
  color: var(--text-secondary);
}

.running-work-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--primary);
}

.running-work-count {
  font-weight: 500;
}

.running-work-view {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  color: var(--text-secondary);
  font-size: var(--font-size-12);
  flex-shrink: 0;
}

.running-work-items {
  border-top: 1px solid var(--border);
  background: var(--bg-base);
  max-height: min(420px, 50dvh);
  overflow: auto;
  overscroll-behavior: contain;
}
</style>
