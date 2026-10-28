import { readonly, ref } from "vue";
import type { TerminalRenderer } from "../components/terminalBackend";

export const TERMINAL_RENDERER_STORAGE_KEY = "shelley-terminal-renderer";

function storedRenderer(): TerminalRenderer {
  try {
    if (localStorage.getItem(TERMINAL_RENDERER_STORAGE_KEY) === "xterm") return "xterm";
  } catch {
    // Use the default when storage is unavailable.
  }
  return "ghostty";
}

const terminalRenderer = ref<TerminalRenderer>(storedRenderer());

function setTerminalRenderer(value: TerminalRenderer): void {
  terminalRenderer.value = value;
  try {
    localStorage.setItem(TERMINAL_RENDERER_STORAGE_KEY, value);
  } catch {
    // The in-memory choice still applies when storage is unavailable.
  }
}

/** What draws terminals in this browser: ghostty-web unless the terminal
 *  panel's menu says xterm.js. */
export function useTerminalRendererPreference() {
  return { terminalRenderer: readonly(terminalRenderer), setTerminalRenderer };
}
