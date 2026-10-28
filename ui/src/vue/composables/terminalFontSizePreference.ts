import { readonly, ref } from "vue";

const STORAGE_KEY = "shelley-terminal-font-size";
const stored = Number(localStorage.getItem(STORAGE_KEY) ?? 14);
const terminalFontSize = ref(Number.isFinite(stored) ? clampSize(stored) : 14);

function clampSize(size: number) {
  return Math.max(8, Math.min(32, Math.round(size)));
}

function setTerminalFontSize(size: number) {
  const next = clampSize(size);
  if (next === terminalFontSize.value) return;
  terminalFontSize.value = next;
  localStorage.setItem(STORAGE_KEY, String(next));
}

export function useTerminalFontSizePreference() {
  return { terminalFontSize: readonly(terminalFontSize), setTerminalFontSize };
}
