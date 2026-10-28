import type { InjectionKey, Ref } from "vue";
import type { Model } from "../../types";
import type { ThinkingLevel } from "./thinkingLevel";

export type RefusalContinueContext = {
  models: Ref<Model[]>;
  selectedModel: Ref<string>;
  thinkingLevel: Ref<ThinkingLevel>;
};

export const RefusalContinueKey: InjectionKey<RefusalContinueContext> = Symbol("refusal-continue");
