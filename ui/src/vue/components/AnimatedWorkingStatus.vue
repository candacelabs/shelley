<!-- Working text yields to controls based on its allocated width, not the viewport. -->
<template>
  <span class="status-message animated-working" role="status">
    <span class="sr-only">Agent working...</span>
    <span
      v-for="(char, idx) in chars"
      :key="idx"
      aria-hidden="true"
      :class="{
        'bold-letter': idx === boldIndex,
        'working-prefix': idx < 6,
        'working-word': idx >= 6 && idx < 13,
      }"
      >{{ char }}</span
    >
  </span>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from "vue";

const chars = "Agent working...".split("");
const boldIndex = ref(0);

const interval = setInterval(() => {
  boldIndex.value = (boldIndex.value + 1) % chars.length;
}, 100);

onUnmounted(() => clearInterval(interval));
</script>
