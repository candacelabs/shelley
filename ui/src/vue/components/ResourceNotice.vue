<template>
  <div
    class="resource-notice"
    :class="{ 'resource-notice-critical': status.critical }"
    :data-testid="`${status.kind}-notice`"
  >
    <span class="resource-notice-icon" aria-hidden="true">!</span>
    <span class="resource-notice-text">
      <!-- Only the title is live: the numbers refresh on every sample and must
           not be re-announced. Keyed so escalating inserts a fresh alert. -->
      <strong
        :key="String(status.critical)"
        :role="status.critical ? 'alert' : 'status'"
        :data-testid="`${status.kind}-notice-title`"
        >{{ t(copy.title[status.critical ? 1 : 0]) }}</strong
      >
      <span class="resource-notice-detail">{{
        t(copy.available).replace("{size}", formatBytes(status.available_bytes))
      }}</span>
      <span v-if="stallPercent" class="resource-notice-detail" :title="t('memoryStalledTitle')"
        >{{ t("memoryStalled").replace("{percent}", String(stallPercent)) }}
        <span class="sr-only">({{ t("memoryStalledTitle") }})</span></span
      >
    </span>
    <a
      v-if="resizeUrl"
      :href="resizeUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="resource-notice-link"
      :data-testid="`${status.kind}-notice-link`"
      >{{ t("resizeVM") }}</a
    >
    <button
      type="button"
      class="btn-icon resource-notice-dismiss"
      :aria-label="t('dismiss')"
      :data-testid="`${status.kind}-notice-dismiss`"
      @click="emit('dismiss', status)"
    >
      ×
    </button>
  </div>
</template>

<script setup lang="ts">
// A server-wide low disk space or memory pressure notice, shown once per
// episode until dismissed. Pairs with resource_status on the stream.
import { computed } from "vue";
import type { ResourceKind, ResourceStatus } from "../../types";
import type { TranslationKeys } from "../../i18n/types";
import { useI18n } from "../composables/i18n";

const props = defineProps<{ status: ResourceStatus }>();
const emit = defineEmits<{ dismiss: [status: ResourceStatus] }>();
const { t } = useI18n();

type Key = keyof TranslationKeys;
const COPY: Record<ResourceKind, { title: [Key, Key]; available: Key }> = {
  disk: { title: ["diskSpaceLow", "diskSpaceCritical"], available: "diskSpaceRemaining" },
  memory: {
    title: ["memoryPressureHigh", "memoryPressureCritical"],
    available: "memoryAvailable",
  },
};
const copy = computed(() => COPY[props.status.kind]);

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

// Zero without PSI, or when memory is short but nothing waits yet.
const stallPercent = computed(() => Math.round(props.status.stall_percent));

// exe.dev VMs grow their disk via the control plane; suggest the current size
// rounded up to the next 10 GB plus 10 GB so the form opens pre-filled.
// Memory has no such link: standalone VMs scale it with vCPUs, and a
// ballooned guest's MemTotal understates the allocation.
const resizeUrl = computed(() => {
  const total = props.status.total_bytes;
  if (props.status.kind !== "disk" || !window.__SHELLEY_INIT__?.is_exe_dev || !total) return null;
  const gb = Math.ceil(total / 1e9 / 10) * 10 + 10;
  const vm = (window.__SHELLEY_INIT__?.hostname ?? "").split(".")[0];
  return `https://exe.dev/suggest?command=${encodeURIComponent(`resize ${vm} --disk=${gb}GB`)}`;
});
</script>
