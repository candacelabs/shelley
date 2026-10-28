import { computed, ref } from "vue";
import { parseStoredPanes, serializePanes, type UsagePane } from "../../utils/usagePanes";

export const USAGE_PANES_STORAGE_KEY = "shelley-usage-panes";

function readStoredPanes(): UsagePane[] {
  try {
    return parseStoredPanes(localStorage.getItem(USAGE_PANES_STORAGE_KEY));
  } catch {
    return parseStoredPanes(null);
  }
}

const storedPanes = ref<UsagePane[]>(readStoredPanes());

/** The graphs the context usage popup stacks, remembered across page loads. */
export function useUsagePanesPreference() {
  const panes = computed<UsagePane[]>({
    get: () => storedPanes.value,
    set: (value) => {
      storedPanes.value = value;
      try {
        localStorage.setItem(USAGE_PANES_STORAGE_KEY, serializePanes(value));
      } catch {
        // The in-memory choice still applies when storage is unavailable.
      }
    },
  });
  return { panes };
}
