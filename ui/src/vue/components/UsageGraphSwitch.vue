<!-- One checkbox per graph in the context usage popup; each switches its graph
     on or off independently. Checkboxes rather than pills, so they read as a
     set of independent choices and not as the calls/time pair beside the graph. -->
<template>
  <div class="usage-graph-switch" role="group" aria-label="Graphs">
    <label v-for="pane in PANES" :key="pane.id" class="usage-graph-switch-item" :title="pane.title">
      <input
        type="checkbox"
        class="usage-graph-switch-box"
        :checked="modelValue.includes(pane.id)"
        :aria-label="pane.title"
        @change="toggle(pane.id)"
      />
      {{ pane.id }}
    </label>
  </div>
</template>

<script setup lang="ts">
import { USAGE_PANES, type UsagePane } from "../../utils/usagePanes";

const props = defineProps<{ modelValue: UsagePane[] }>();
const emit = defineEmits<{ "update:modelValue": [value: UsagePane[]] }>();

const TITLES: Record<UsagePane, string> = {
  context: "Context length",
  cumulative: "Cumulative cost",
  incremental: "Incremental cost",
};
const PANES = USAGE_PANES.map((id) => ({ id, title: TITLES[id] }));

function toggle(pane: UsagePane) {
  emit(
    "update:modelValue",
    props.modelValue.includes(pane)
      ? props.modelValue.filter((p) => p !== pane)
      : [...props.modelValue, pane],
  );
}
</script>
