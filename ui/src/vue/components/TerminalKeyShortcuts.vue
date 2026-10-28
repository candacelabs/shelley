<template>
  <div
    class="terminal-key-shortcuts"
    role="group"
    aria-label="Terminal key shortcuts"
    @pointercancel="releaseInputFocus"
  >
    <button
      v-for="modifier in ['Ctrl', 'Alt'] as const"
      :key="modifier"
      :aria-pressed="modifier === 'Ctrl' ? ctrl : alt"
      :disabled="disabled"
      @pointerdown.prevent
      @click="toggleModifier(modifier)"
    >
      {{ modifier }}
    </button>
    <button
      v-for="key in KEYS"
      :key="key.label"
      :aria-label="key.name ?? key.label"
      :disabled="disabled"
      @pointerdown.prevent
      @click="send(key.data)"
    >
      {{ key.label }}
    </button>
    <button :disabled="disabled" @pointerdown.prevent @click="paste">Paste</button>
    <span v-if="pasteError" role="alert">{{ pasteError }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { TerminalHandle } from "./terminalBackend";

const props = defineProps<{ terminal: () => TerminalHandle | undefined; disabled: boolean }>();
const ctrl = ref(false);
const alt = ref(false);
const pasteError = ref("");
const KEYS = [
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "^C", name: "Ctrl+C", data: "\x03" },
  { label: "^D", name: "Ctrl+D", data: "\x04" },
  { label: "^Z", name: "Ctrl+Z", data: "\x1a" },
  { label: "↑", name: "Arrow up", data: "\x1b[A" },
  { label: "↓", name: "Arrow down", data: "\x1b[B" },
  { label: "←", name: "Arrow left", data: "\x1b[D" },
  { label: "→", name: "Arrow right", data: "\x1b[C" },
  { label: "Home", data: "\x1b[H" },
  { label: "End", data: "\x1b[F" },
  { label: "Del", name: "Delete", data: "\x1b[3~" },
];

// A native horizontal swipe must not revive a dismissed Android keyboard.
function releaseInputFocus() {
  const input = document.activeElement;
  if (input instanceof HTMLElement && input.matches("input, textarea, [contenteditable=true]")) {
    input.blur();
  }
}

function clearModifiers() {
  ctrl.value = alt.value = false;
}

function toggleModifier(modifier: "Ctrl" | "Alt") {
  if (modifier === "Ctrl") ctrl.value = !ctrl.value;
  else alt.value = !alt.value;
  props.terminal()?.focus();
}

// Transform input after the emulator has encoded it, including soft-keyboard
// input. Leave terminal protocol replies and multi-character pastes alone.
function transformInput(data: string): string {
  if (!ctrl.value && !alt.value) return data;
  const arrow = /^\x1b(?:\[|O)([ABCD])$/.exec(data);
  if (arrow) {
    data = `\x1b[1;${1 + (alt.value ? 2 : 0) + (ctrl.value ? 4 : 0)}${arrow[1]}`;
  } else if (data.length === 1) {
    if (ctrl.value) {
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
      else if (data === " ") data = "\x00";
      else if (data === "?") data = "\x7f";
    }
    if (alt.value) data = "\x1b" + data;
  } else {
    return data;
  }
  clearModifiers();
  return data;
}

function send(data: string) {
  const terminal = props.terminal();
  // Only arrows use the latched modifiers; explicit control keys always
  // send exactly their labeled key.
  const input = /^\x1b\[[ABCD]$/.test(data) ? transformInput(data) : data;
  clearModifiers();
  terminal?.input(input);
  terminal?.focus();
}

async function paste() {
  const terminal = props.terminal();
  clearModifiers();
  pasteError.value = "";
  terminal?.focus();
  try {
    const text = await navigator.clipboard.readText();
    terminal?.paste(text);
  } catch (error) {
    pasteError.value = `Paste failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

defineExpose({ transformInput });
</script>
