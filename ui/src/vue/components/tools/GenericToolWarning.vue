<!-- Shared bug indicator for any generic tool fallback. -->
<template>
  <a
    :href="reportBugURL"
    :aria-label="`GENERIC TOOL RESULT (Please report a bug) — missing UI for ${reportedToolName} (opens in new tab)`"
    class="generic-tool-warning"
    target="_blank"
    rel="noopener noreferrer"
    @click.stop
    @keydown.space.prevent.stop
  >
    GENERIC TOOL RESULT (Please report a bug)
  </a>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { genericToolReportName, genericToolReportURL } from "../../../utils/genericToolReport";

const props = defineProps<{
  toolName: string;
}>();

const reportedToolName = computed(() => genericToolReportName(props.toolName));
const reportBugURL = computed(() => genericToolReportURL(props.toolName));
</script>
