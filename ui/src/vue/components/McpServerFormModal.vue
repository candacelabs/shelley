<!-- Add / edit an MCP server, stacked on McpServersModal like ModelFormModal.
     The server validates; its message is shown. `editServer` is null when
     adding (a server's name can't change). -->
<template>
  <Modal
    :is-open="isOpen"
    :title="editServer ? t('editMcpServer') : t('addMcpServer')"
    class-name="modal-wide"
    @close="emit('close')"
  >
    <form class="model-form" @submit.prevent="save">
      <div v-if="error" class="models-error" role="alert">
        {{ error }}
        <button
          type="button"
          class="models-error-dismiss"
          :aria-label="t('dismiss')"
          @click="error = null"
        >
          ×
        </button>
      </div>

      <div class="form-group">
        <label for="mcp-server-name">{{ t("columnName") }}</label>
        <InputText
          id="mcp-server-name"
          v-model="form.name"
          :disabled="!!editServer"
          placeholder="github"
          fluid
          :dt="inputFieldDt"
          autocomplete="off"
          spellcheck="false"
        />
        <div v-if="!editServer" class="form-hint">{{ t("mcpNameHint") }}</div>
      </div>

      <div class="form-group">
        <label for="mcp-server-url">URL</label>
        <InputText
          id="mcp-server-url"
          v-model="form.url"
          placeholder="https://example.com/mcp"
          fluid
          :dt="inputFieldDt"
          autocomplete="off"
          spellcheck="false"
        />
      </div>

      <div class="form-group">
        <label for="mcp-server-description">{{ t("columnDescription") }}</label>
        <InputText
          id="mcp-server-description"
          v-model="form.description"
          :placeholder="t('mcpDescriptionPlaceholder')"
          fluid
          :dt="inputFieldDt"
        />
      </div>

      <div class="form-group" role="group" aria-labelledby="mcp-server-headers">
        <label id="mcp-server-headers">{{ t("mcpHeaders") }}</label>
        <div v-for="(row, i) in form.headers" :key="i" class="mcp-header-row">
          <InputText
            v-model="row[0]"
            placeholder="Authorization"
            :aria-label="`${t('columnName')} ${i + 1}`"
            fluid
            :dt="inputFieldDt"
            autocomplete="off"
            spellcheck="false"
          />
          <InputText
            v-model="row[1]"
            :placeholder="t('mcpValue')"
            :aria-label="`${t('mcpValue')} ${i + 1}`"
            fluid
            :dt="inputFieldDt"
            autocomplete="off"
            spellcheck="false"
          />
          <Button
            class="btn-icon"
            text
            severity="secondary"
            :aria-label="t('mcpRemoveHeader').replace('{n}', String(i + 1))"
            @click="form.headers.splice(i, 1)"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </Button>
        </div>
        <Button
          size="small"
          text
          :label="`+ ${t('mcpAddHeader')}`"
          @click="form.headers.push(['', ''])"
        />
      </div>

      <div class="form-actions">
        <Button type="button" severity="secondary" :label="t('cancel')" @click="emit('close')" />
        <Button
          type="submit"
          :label="editServer ? t('save') : t('addMcpServer')"
          :disabled="saving || !form.name.trim() || !form.url.trim()"
        />
      </div>
    </form>
  </Modal>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Modal from "./Modal.vue";
import { inputFieldDt } from "./configFieldDt";
import { useI18n } from "../composables/i18n";
import { mcpServersApi, type McpServer } from "../../services/api";

const props = defineProps<{ isOpen: boolean; editServer: McpServer | null }>();
const emit = defineEmits<{ (e: "close"): void; (e: "saved"): void }>();

const { t } = useI18n();

const form = reactive({ name: "", url: "", description: "", headers: [] as string[][] });
const error = ref<string | null>(null);
const saving = ref(false);

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return;
    const s = props.editServer;
    Object.assign(form, {
      name: s?.name ?? "",
      url: s?.url ?? "",
      description: s?.description ?? "",
      headers: Object.entries(s?.headers ?? {}),
    });
    error.value = null;
  },
  { immediate: true },
);

async function save() {
  error.value = null;
  saving.value = true;
  try {
    await mcpServersApi.save(
      {
        name: form.name.trim(),
        url: form.url.trim(),
        description: form.description.trim(),
        // Blank rows are dropped; anything else goes to the server to validate.
        headers: Object.fromEntries(
          form.headers.map(([k, v]) => [k.trim(), v.trim()]).filter(([k, v]) => k || v),
        ),
      },
      !props.editServer,
    );
    emit("saved");
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    saving.value = false;
  }
}
</script>
