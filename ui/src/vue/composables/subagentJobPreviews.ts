import { ref, watch, type Ref } from "vue";
import { api, type BackgroundJob } from "../../services/api";
import type { ConversationWithState } from "../../types";

export function useSubagentJobPreviews(
  subagents: Ref<ConversationWithState[]>,
  enabled: Ref<boolean>,
) {
  const jobs = ref(new Map<string, BackgroundJob[]>());
  const error = ref("");

  watch(
    [
      () =>
        JSON.stringify(
          subagents.value
            .filter((sub) => sub.running_background_jobs > 0)
            .map((sub) => [sub.conversation_id, sub.running_background_jobs]),
        ),
      enabled,
    ],
    ([, active], _, onCleanup) => {
      let disposed = false;
      let poll: number | undefined;
      onCleanup(() => {
        disposed = true;
        window.clearTimeout(poll);
      });
      if (!active) return;
      const owners = subagents.value.filter((sub) => sub.running_background_jobs > 0);
      if (owners.length === 0) {
        jobs.value = new Map();
        error.value = "";
        return;
      }

      async function refresh() {
        try {
          const entries = await Promise.all(
            owners.map(async (sub) => {
              const id = sub.conversation_id;
              return [id, await api.getBackgroundJobs(id)] as const;
            }),
          );
          if (disposed) return;
          jobs.value = new Map(entries);
          error.value = "";
        } catch (e) {
          if (!disposed) error.value = e instanceof Error ? e.message : String(e);
        } finally {
          if (!disposed) poll = window.setTimeout(() => void refresh(), 3000);
        }
      }
      void refresh();
    },
    { immediate: true },
  );

  return { jobs, error };
}
