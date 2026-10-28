<template>
  <ul ref="list" class="git-graph-diffstat-list">
    <li v-for="f in files" :key="f.path" class="git-graph-diffstat-row">
      <a
        class="git-graph-diffstat-link"
        :href="fileHref(f.path)"
        :title="f.path"
        :aria-label="ariaLabel(f)"
        @click="onClick($event, f.path)"
      >
        <span class="git-graph-diffstat-path">{{ labels.get(f.path) ?? f.path }}</span>
        <span class="git-graph-diffstat-counts">
          <span v-if="f.binary" class="git-graph-diffstat-binary">bin</span>
          <template v-else>
            <span v-if="f.additions > 0" class="git-graph-diffstat-ins">+{{ f.additions }}</span>
            <span v-if="f.deletions > 0" class="git-graph-diffstat-del">−{{ f.deletions }}</span>
          </template>
        </span>
      </a>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { pathShortener } from "./shortenPaths";

interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

const props = defineProps<{ files: DiffFile[]; fileHref: (path: string) => string }>();
const emit = defineEmits<{ (e: "open", path: string): void }>();
const list = ref<HTMLUListElement | null>(null);
const labels = ref(new Map<string, string>());
let observer: ResizeObserver | null = null;

function onClick(e: MouseEvent, path: string) {
  // Let the browser handle modifier/middle-click so users can open the diff
  // in a new tab/window.
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  emit("open", path);
}

function ariaLabel(f: DiffFile): string {
  if (f.binary) return `${f.path}, binary`;
  const counts = [
    f.additions > 0 ? `${f.additions} added` : "",
    f.deletions > 0 ? `${f.deletions} removed` : "",
  ].filter(Boolean);
  return [f.path, ...counts].join(", ");
}

onMounted(() => {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("Cannot measure file paths");
  let shorten: ReturnType<typeof pathShortener>;
  let width = -1;
  const updateLabels = () => {
    const path = list.value?.querySelector<HTMLElement>(".git-graph-diffstat-path");
    if (!path) return;
    const next = path.getBoundingClientRect().width;
    if (next === width) return;
    width = next;
    context.font = getComputedStyle(path).font;
    labels.value = shorten((text) => context.measureText(text).width <= width);
  };
  observer = new ResizeObserver(updateLabels);
  observer.observe(list.value!);
  watch(
    () => props.files,
    (files) => {
      shorten = pathShortener(files.map((f) => f.path));
      width = -1;
      updateLabels();
    },
    { flush: "post", immediate: true },
  );
  void document.fonts.ready.then(() => {
    width = -1;
    updateLabels();
  });
});

onUnmounted(() => observer?.disconnect());
</script>
