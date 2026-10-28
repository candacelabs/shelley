<!-- A tool definition as a compact card: its name and a one-line preview,
     expanding to the full description, the default slot (extra metadata) and
     a table of its parameters. Used by SystemPromptView (the agent's tools)
     and McpToolsModal (an MCP server's tools). Bind v-model:expanded to keep
     the state outside the card. -->
<template>
  <article
    class="system-prompt-card system-prompt-tool-item"
    :class="{ 'system-prompt-card--expanded': expanded }"
  >
    <button
      type="button"
      class="system-prompt-card-summary"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="system-prompt-card-copy">
        <code class="system-prompt-card-name system-prompt-tool-name">{{ name }}</code>
        <span class="system-prompt-card-preview">{{ preview || firstLine }}</span>
      </span>
      <ToolChevron :expanded="expanded" />
      <span class="sr-only">{{ expanded ? "Collapse" : "Expand" }}</span>
    </button>

    <div v-if="expanded" class="system-prompt-card-detail">
      <p v-if="text" class="system-prompt-card-full-description">
        {{ text }}
      </p>
      <slot />

      <div v-if="params.length > 0" class="system-prompt-tool-params">
        <div class="system-prompt-tool-params-label">Parameters</div>
        <table class="system-prompt-tool-params-table">
          <tbody>
            <tr
              v-for="[paramName, prop] in params"
              :key="paramName"
              class="system-prompt-tool-param-row"
            >
              <td class="system-prompt-tool-param-name">
                <code>{{ paramName }}</code>
                <span v-if="required.has(paramName)" class="system-prompt-tool-param-required"
                  >*</span
                >
              </td>
              <td class="system-prompt-tool-param-type">
                <code>{{ Array.isArray(prop.type) ? prop.type.join(" | ") : prop.type }}</code>
              </td>
              <td class="system-prompt-tool-param-desc">
                <span v-if="prop.description">{{ prop.description }}</span>
                <span
                  v-if="prop.enum && prop.enum.length > 0"
                  class="system-prompt-tool-param-enum"
                >
                  {{ " " }}Allowed values:{{ " " }}
                  <template v-for="(value, index) in prop.enum" :key="index">
                    <template v-if="index > 0">, </template>
                    <code>{{ String(value) }}</code>
                  </template>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { ToolSchema } from "../../services/api";
import ToolChevron from "./tools/ToolChevron.vue";

const props = defineProps<{
  name: string;
  description?: string;
  // The summary line under the name; the description's first line if empty.
  preview?: string;
  parameters?: ToolSchema;
}>();
const expanded = defineModel<boolean>("expanded", { default: false });

const text = computed(() => props.description?.trim() ?? "");
const firstLine = computed(() => text.value.split("\n")[0]);
const params = computed(() => Object.entries(props.parameters?.properties ?? {}));
const required = computed(() => new Set(props.parameters?.required ?? []));
</script>
