<!-- An MCP server's tools, as the same cards as the System Prompt view.
     Listing connects to the server, and an open request keeps its session in
     use, so the request is aborted when the dialog closes. -->
<template>
  <Modal
    :is-open="server !== null"
    :title="t('mcpToolsTitle').replace('{name}', name)"
    class-name="modal-wide"
    @close="emit('close')"
  >
    <div v-if="loading" class="models-loading">
      <div class="spinner"></div>
      <span>{{ t("mcpConnecting").replace("{name}", name) }}</span>
    </div>
    <div v-else-if="error" class="models-error" role="alert">{{ error }}</div>
    <p v-else-if="tools.length === 0" class="models-empty">{{ t("mcpNoTools") }}</p>
    <div v-else class="system-prompt-card-grid">
      <ToolDescriptionCard
        v-for="tool in tools"
        :key="tool.name"
        :name="tool.name"
        :description="tool.description"
        :parameters="tool.inputSchema"
      />
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import Modal from "./Modal.vue";
import ToolDescriptionCard from "./ToolDescriptionCard.vue";
import { useI18n } from "../composables/i18n";
import { mcpServersApi, type McpTool } from "../../services/api";

// The server's name; null when closed.
const props = defineProps<{ server: string | null }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();

// Kept after closing so the title doesn't blank out while the dialog fades.
const name = ref("");
const tools = ref<McpTool[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

watch(
  () => props.server,
  async (server, _, onCleanup) => {
    if (server === null) return;
    // Aborted when the dialog closes or shows another server; an aborted
    // request's outcome is dropped.
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    name.value = server;
    tools.value = [];
    error.value = null;
    loading.value = true;
    try {
      const result = await mcpServersApi.tools(server, controller.signal);
      if (!controller.signal.aborted) tools.value = result;
    } catch (err) {
      if (!controller.signal.aborted)
        error.value = err instanceof Error ? err.message : String(err);
    }
    if (!controller.signal.aborted) loading.value = false;
  },
  { immediate: true },
);
</script>
