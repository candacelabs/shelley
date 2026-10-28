<template>
  <div v-if="elapsed" class="tool-running-elapsed" data-testid="tool-running-elapsed">
    <slot :elapsed="elapsed">Running for {{ elapsed }}</slot>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { elapsedSince } from "./toolElapsed";

const props = defineProps<{ startTime?: string | null }>();
const now = ref(Date.now());
const elapsed = computed(() => elapsedSince(props.startTime, now.value));

let timer: number | undefined;
onMounted(() => {
  now.value = Date.now();
  timer = window.setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => {
  if (timer !== undefined) window.clearInterval(timer);
});
</script>
