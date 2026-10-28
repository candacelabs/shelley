import { ref, watch, type InjectionKey, type Ref } from "vue";
import { api, type BackgroundJob } from "../../services/api";

export const BackgroundJobsKey: InjectionKey<ReturnType<typeof useBackgroundJobs>> =
  Symbol("shelley-background-jobs");

export function useBackgroundJobs(conversationId: Ref<string | null>, count: Ref<number>) {
  const jobs = ref<BackgroundJob[] | null>(null);
  const error = ref("");
  const killing = ref(new Set<string>());

  watch(
    [conversationId, count],
    ([id, running], previous, onCleanup) => {
      let disposed = false;
      let poll: number | undefined;
      onCleanup(() => {
        disposed = true;
        window.clearTimeout(poll);
      });

      if (!id || running === 0) {
        jobs.value = [];
        error.value = "";
        killing.value = new Set();
        return;
      }
      if (id !== previous?.[0] || previous?.[1] === 0) {
        jobs.value = null;
        error.value = "";
        killing.value = new Set();
      }

      async function refresh() {
        try {
          const list = await api.getBackgroundJobs(id!);
          if (disposed) return;
          jobs.value = list;
          error.value = "";
          killing.value = new Set(
            [...killing.value].filter((jobId) => list.some((job) => job.job_id === jobId)),
          );
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

  async function stop(jobId: string) {
    const id = conversationId.value;
    if (!id) throw new Error("Cannot stop a command without a conversation");
    killing.value = new Set(killing.value).add(jobId);
    try {
      await api.killBackgroundJob(id, jobId);
    } catch (e) {
      if (conversationId.value !== id) return;
      error.value = e instanceof Error ? e.message : String(e);
      const next = new Set(killing.value);
      next.delete(jobId);
      killing.value = next;
    }
  }

  return { jobs, error, killing, stop };
}
