<template>
  <span v-if="text !== null" class="path-text" :title="title ?? text">
    <span v-if="parts.prefix.length" class="path-text-prefix">
      <template v-for="(segment, index) in parts.prefix" :key="index">
        <mark v-if="segment.hit" class="grp-hit">{{ segment.text }}</mark>
        <template v-else>{{ segment.text }}</template>
      </template>
    </span>
    <span class="path-text-tail ellipsis-start">
      <template v-for="(segment, index) in parts.tail" :key="index">
        <mark v-if="segment.hit" class="grp-hit">{{ segment.text }}</mark>
        <template v-else>{{ segment.text }}</template>
      </template>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { HighlightSegment } from "../../utils/fileSearch";

const props = defineProps<{
  text: string | null;
  title?: string;
  segments?: HighlightSegment[];
}>();

const parts = computed(() => {
  if (props.text === null) return { prefix: [], tail: [] };
  let remaining = props.text.startsWith("~/") ? 2 : 0;
  const prefix: HighlightSegment[] = [];
  const tail: HighlightSegment[] = [];
  for (const segment of props.segments ?? [{ text: props.text, hit: false }]) {
    const cut = Math.min(remaining, segment.text.length);
    if (cut) prefix.push({ ...segment, text: segment.text.slice(0, cut) });
    if (cut < segment.text.length) tail.push({ ...segment, text: segment.text.slice(cut) });
    remaining -= cut;
  }
  return { prefix, tail };
});
</script>
