<!-- Sub-component of Message.vue (ported from GitInfoMessage in
     components/Message.tsx). Compact git-state notification. Preserves the
     .message.message-gitinfo container, data-testid "message-gitinfo", and the
     msg-* classes for the worktree/branch/hash/subject/diff link. -->
<template>
  <div
    v-if="commitHash"
    ref="containerRef"
    class="message message-gitinfo msg-gitinfo-container"
    :data-testid="isTourRequest ? 'message-tour-request' : 'message-gitinfo'"
    @mouseenter="refreshTour"
  >
    <div class="msg-gitinfo-content">
      <span v-if="subject" class="msg-subject" :title="subject">{{ subject }}</span>
      <span v-if="branch" class="msg-branch">{{ branch }}</span>
      <button type="button" class="msg-commit-hash" title="Click to copy commit hash" @click="handleCopyHash">{{ shortCommitHash }}</button>
      <span class="msg-copy-status" aria-live="polite">{{ copied ? "Commit hash copied" : "" }}</span>
      <span v-if="worktree" ref="worktreeRef" class="msg-worktree" :title="worktree">{{ worktreeLabel }}</span>
      <a v-if="canShowDiff" :href="filesHref" class="msg-diff-link" @click="onDiffLinkClick($event, true)">Open Diff</a>
      <template v-if="tourState === 'present' && canShowDiff">
        <a :href="diffHref" class="msg-diff-link msg-tour-link" data-testid="gitinfo-tour-link" v-tooltip.top="'Open guided commit tour'" @click="onDiffLinkClick">Open Tour</a>
      </template>
      <template v-else-if="tourState === 'absent' && canRequestTour">
        <button type="button" class="msg-tour-action" data-testid="gitinfo-tour-request" :disabled="requestingTour" v-tooltip.top="'Build a guided tour in a subagent'" @click="requestTour">{{ requestingTour ? "Requesting…" : "Build tour" }}</button>
      </template>
      <template v-else-if="tourState === 'building'">
        <a v-if="canShowDiff" :href="diffHref" class="msg-tour-building" data-testid="gitinfo-tour-building" v-tooltip.top="'Open the tour being built'" @click="onDiffLinkClick"><span class="spinner spinner-small" aria-hidden="true" /> Building tour</a>
        <span v-else class="msg-tour-building" data-testid="gitinfo-tour-building"><span class="spinner spinner-small" aria-hidden="true" /> Building tour</span>
      </template>
      <template v-else-if="tourState === 'failed' && canRequestTour">
        <span class="msg-tour-failure">
          <span class="msg-tour-failed" data-testid="gitinfo-tour-failed">Tour failed</span>
          <button
            type="button"
            class="msg-tour-action"
            :disabled="requestingTour"
            v-tooltip.top="tourStatus?.error || 'The subagent did not attach a valid tour'"
            @click="requestTour"
          >
            {{ requestingTour ? "Requesting…" : "Retry" }}
          </button>
        </span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { GitTourBuildStatus } from "../../services/api";
import {
  loadCommitTourStatus,
  requestCommitTour,
  subscribeCommitTourStatus,
} from "../../services/commitTourStatus";
import type { Message as MessageType } from "../../types";
import { pathShortener } from "./gitGraph/shortenPaths";
import { tildifyPath } from "../../utils/tildify";

const props = defineProps<{
  message: MessageType;
  onOpenDiffViewer?: (commit: string, cwd?: string, openOnFiles?: boolean) => void;
  canRequestTour?: boolean;
}>();

const copied = ref(false);
const containerRef = ref<HTMLElement | null>(null);
const tourStatus = ref<GitTourBuildStatus | null>(null);
const requestingTour = ref(false);
let lastForcedTourProbeAt = 0;
let tourPollTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeTour: (() => void) | null = null;
let disposed = false;

const parsed = computed(() => {
  let commitHash: string | null = null;
  let subject: string | null = null;
  let branch: string | null = null;
  let worktree: string | null = null;
  let tourRequest = false;

  if (props.message.user_data) {
    try {
      const userData =
        typeof props.message.user_data === "string"
          ? JSON.parse(props.message.user_data)
          : props.message.user_data;
      if (userData.commit) commitHash = userData.commit;
      if (userData.subject) subject = userData.subject;
      if (userData.branch) branch = userData.branch;
      if (userData.worktree) worktree = userData.worktree;
      tourRequest = userData.tour_request === true;
    } catch (err) {
      console.error("Failed to parse gitinfo user_data:", err);
    }
  }
  return { commitHash, subject, branch, worktree, tourRequest };
});

const isTourRequest = computed(() => parsed.value.tourRequest);
const commitHash = computed(() => parsed.value.commitHash);
const subject = computed(() => parsed.value.subject);
const branch = computed(() => parsed.value.branch);
const worktree = computed(() => parsed.value.worktree);
const shortCommitHash = computed(() => commitHash.value?.slice(0, 8) ?? "");
const worktreeRef = ref<HTMLElement | null>(null);
const displayWorktree = computed(() => tildifyPath(worktree.value) || "");
const worktreeLabel = ref(displayWorktree.value);
let worktreeObserver: ResizeObserver | null = null;

onMounted(() => {
  const element = worktreeRef.value;
  if (!element) return;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Cannot measure worktree paths");
  const updateLabel = () => {
    if (disposed) return;
    const path = displayWorktree.value;
    const width = element.getBoundingClientRect().width;
    context.font = getComputedStyle(element).font;
    worktreeLabel.value = pathShortener([path])(
      (text) => context.measureText(text).width <= width,
    ).get(path)!;
  };
  worktreeObserver = new ResizeObserver(updateLabel);
  worktreeObserver.observe(element);
  watch(displayWorktree, updateLabel, { flush: "post" });
  void document.fonts.ready.then(updateLabel);
});

const tourState = computed(() => tourStatus.value?.status ?? "unknown");
const canShowDiff = computed(() => !!commitHash.value && !!props.onOpenDiffViewer);

const diffHref = computed(() => {
  const params = new URLSearchParams();
  params.set("diff", commitHash.value!);
  if (worktree.value) params.set("cwd", worktree.value);
  return `${window.location.pathname}?${params.toString()}`;
});
const filesHref = computed(() => `${diffHref.value}&view=files`);

function onDiffLinkClick(e: MouseEvent, openOnFiles = false) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  if (commitHash.value && props.onOpenDiffViewer) {
    props.onOpenDiffViewer(commitHash.value, worktree.value || undefined, openOnFiles);
  }
}

function scheduleTourPoll() {
  if (tourPollTimer) clearTimeout(tourPollTimer);
  tourPollTimer = null;
  if (disposed || tourState.value !== "building") return;
  tourPollTimer = setTimeout(() => void probeTour(true), 2_000);
}

function applyTourStatus(status: GitTourBuildStatus) {
  tourStatus.value = status;
  scheduleTourPoll();
}

async function probeTour(force = false) {
  const hash = commitHash.value;
  const cwd = worktree.value;
  if (!hash || !cwd) return;
  try {
    const status = await loadCommitTourStatus(cwd, hash, force);
    if (!disposed) applyTourStatus(status);
  } catch (error) {
    if (disposed) return;
    console.error("Failed to check commit tour:", error);
    if (isTourRequest.value && tourState.value !== "building") {
      if (tourPollTimer) clearTimeout(tourPollTimer);
      tourPollTimer = setTimeout(() => void probeTour(true), 2_000);
    } else {
      scheduleTourPoll();
    }
  }
}

function refreshTour() {
  const now = Date.now();
  const force =
    (tourState.value === "absent" || tourState.value === "failed") &&
    now - lastForcedTourProbeAt >= 5_000;
  if (force) lastForcedTourProbeAt = now;
  void probeTour(force);
}

async function requestTour() {
  const hash = commitHash.value;
  const cwd = worktree.value;
  if (!hash || !cwd || !props.message.conversation_id || requestingTour.value) return;
  requestingTour.value = true;
  try {
    applyTourStatus(await requestCommitTour(props.message.conversation_id, cwd, hash));
  } catch (error) {
    applyTourStatus({
      status: "failed",
      hash,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    requestingTour.value = false;
  }
}

let tourObserver: IntersectionObserver | null = null;
onMounted(() => {
  const hash = commitHash.value;
  const cwd = worktree.value;
  if (hash && cwd) unsubscribeTour = subscribeCommitTourStatus(cwd, hash, applyTourStatus);
  if (!containerRef.value || !("IntersectionObserver" in window)) {
    void probeTour();
    return;
  }
  tourObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    tourObserver?.disconnect();
    tourObserver = null;
    void probeTour();
  });
  tourObserver.observe(containerRef.value);
});
onBeforeUnmount(() => {
  disposed = true;
  tourObserver?.disconnect();
  worktreeObserver?.disconnect();
  unsubscribeTour?.();
  if (tourPollTimer) clearTimeout(tourPollTimer);
});

function handleCopyHash(e: MouseEvent) {
  e.preventDefault();
  if (commitHash.value) {
    navigator.clipboard.writeText(commitHash.value).then(() => {
      copied.value = true;
      setTimeout(() => (copied.value = false), 1500);
    });
  }
}
</script>
