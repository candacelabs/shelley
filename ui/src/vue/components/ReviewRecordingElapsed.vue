<!-- A narrated review's running time. Its own component so each tick
     re-renders only this, not the buttons whose open tooltips a re-render
     drops (see DiffViewer). -->
<template>
  <time>{{ formatDuration(ms.value) }}</time>
</template>

<script setup lang="ts">
import type { Ref } from "vue";
import { formatDuration } from "./reviewRecordingFormat";

defineProps<{ ms: Readonly<Ref<number>> }>();
</script>
