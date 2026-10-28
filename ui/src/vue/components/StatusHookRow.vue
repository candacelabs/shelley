<!-- The status-bar hook's row, above the status bar: its body, or its error.
     Plain text with URLs linked, VM-local ones through the proxy; not chat
     formatting, so a backtick in a commit subject stays a backtick. A stale
     status, the previous conversation's, only holds the row's place. -->
<template>
  <div v-if="text && stale" class="status-hook-row" data-testid="status-bar-hook">&nbsp;</div>
  <div
    v-else-if="text"
    :class="['status-hook-row', { 'status-hook-row-error': status?.error }]"
    :style="status?.error ? undefined : { backgroundColor: status?.bgcolor, color: status?.color }"
    :title="text"
    data-testid="status-bar-hook"
  >
    <template v-for="(part, i) in parts" :key="i">
      <a
        v-if="part.type === 'link'"
        :href="part.href"
        target="_blank"
        rel="noopener noreferrer"
        class="text-link"
        >{{ part.content }}</a
      >
      <template v-else>{{ part.content }}</template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { StatusBar } from "../../services/api";
import { localhostLinkOptionsFromInit, parseLinks } from "../../utils/linkify";

const props = defineProps<{ status: StatusBar | null; stale: boolean }>();

const text = computed(() => props.status?.error || props.status?.body || "");
const parts = computed(() => parseLinks(text.value, localhostLinkOptionsFromInit()));
</script>
