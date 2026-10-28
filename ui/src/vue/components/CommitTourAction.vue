<template>
  <button
    v-if="status?.status === 'building'"
    type="button"
    class="commit-tour-action"
    @click="emit('open', hash)"
  >
    <span class="spinner spinner-small" aria-hidden="true" />
    Building tour →
  </button>
  <button
    v-else-if="conversationId && (status?.status === 'absent' || status?.status === 'failed')"
    v-tooltip.top="status.error || 'Build a guided tour in a subagent'"
    type="button"
    class="commit-tour-action"
    :disabled="requesting"
    @click="request(conversationId)"
  >
    <span v-if="requesting" class="spinner spinner-small" aria-hidden="true" />
    {{ requesting ? "Building tour" : "Build tour" }}
  </button>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import type { GitTourBuildStatus } from "../../services/api";
import {
  loadCommitTourStatus,
  requestCommitTour,
  subscribeCommitTourStatus,
} from "../../services/commitTourStatus";

const props = defineProps<{
  cwd: string;
  hash: string;
  conversationId?: string | null;
}>();
const emit = defineEmits<{
  (e: "present", hash: string): void;
  (e: "status", status: GitTourBuildStatus | null): void;
  (e: "open", hash: string): void;
}>();

const status = ref<GitTourBuildStatus | null>(null);
const requesting = ref(false);
// Bumped per request and per commit, so only the latest request settles `requesting`.
let requestSeq = 0;

// Follows the shared status (services/commitTourStatus), polling while a
// build runs and retrying failed probes.
watch(
  [() => props.cwd, () => props.hash],
  ([dir, hash], _, onCleanup) => {
    status.value = null;
    emit("status", null);
    requesting.value = false;
    requestSeq++;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const probeLater = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void probe(), 2_000);
    };
    const update = (next: GitTourBuildStatus) => {
      if (!active) return;
      status.value = next;
      emit("status", next);
      if (next.status === "building") probeLater();
      else if (timer) clearTimeout(timer);
      if (next.status === "present") emit("present", hash);
    };
    const probe = async () => {
      try {
        update(await loadCommitTourStatus(dir, hash, true));
      } catch (error) {
        if (!active) return;
        console.error("Failed to check commit tour:", error);
        probeLater();
      }
    };
    const unsubscribe = subscribeCommitTourStatus(dir, hash, update);
    void probe();
    onCleanup(() => {
      active = false;
      unsubscribe();
      if (timer) clearTimeout(timer);
    });
  },
  { immediate: true },
);

async function request(conversationId: string) {
  const { cwd, hash } = props;
  if (requesting.value) return;
  requesting.value = true;
  const seq = ++requestSeq;
  try {
    await requestCommitTour(conversationId, cwd, hash);
  } catch (error) {
    if (seq === requestSeq) {
      status.value = {
        status: "failed",
        hash,
        error: error instanceof Error ? error.message : String(error),
      };
      emit("status", status.value);
    }
  } finally {
    if (seq === requestSeq) requesting.value = false;
  }
}

defineExpose({ request });
</script>
