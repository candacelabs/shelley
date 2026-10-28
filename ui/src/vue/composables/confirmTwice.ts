import { onBeforeUnmount, ref } from "vue";

// A confirming click this soon after arming is the rest of a double-click
// (or a key bounce), not a second thought.
const SETTLE_MS = 400;

// Two-click confirmation for destructive buttons: the first click arms `key`
// for a few seconds; a second click on the same key runs the action.
export function useConfirmTwice<T>(ms = 4000) {
  const armed = ref<T | null>(null);
  let timer: number | null = null;
  let armedAt = 0;
  function reset() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    armed.value = null;
  }
  onBeforeUnmount(reset);
  function click(key: T, action: () => void) {
    if (armed.value === key) {
      if (performance.now() - armedAt < SETTLE_MS) return;
      reset();
      return action();
    }
    reset();
    armed.value = key;
    armedAt = performance.now();
    timer = window.setTimeout(reset, ms);
  }
  return { armed, click, reset };
}
