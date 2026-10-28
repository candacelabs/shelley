<template>
  <InputGroup ref="group" tabindex="-1">
    <InputText
      :id="inputId"
      :data-testid="inputId"
      :model-value="modelValue"
      type="text"
      inputmode="url"
      :placeholder="t('endpoint')"
      :dt="inputFieldDt"
      autocomplete="off"
      autocapitalize="none"
      autocorrect="off"
      :spellcheck="false"
      @update:model-value="emit('update:modelValue', $event ?? '')"
      @keydown.down.prevent="menu?.show($event, group?.$el)"
    />
    <Button
      type="button"
      icon="pi pi-chevron-down"
      severity="secondary"
      outlined
      :aria-label="t('endpoint')"
      aria-haspopup="menu"
      :aria-controls="`${inputId}-presets`"
      :aria-expanded="menuOpen"
      @click="menu?.toggle($event, group?.$el)"
    />
  </InputGroup>
  <Menu
    :id="`${inputId}-presets`"
    ref="menu"
    :model="items"
    popup
    :aria-label="t('endpoint')"
    :pt="{
      root: { style: { maxWidth: 'calc(100vw - 2rem)' } },
      list: { style: { maxHeight: 'min(18rem, 45dvh)', overflowY: 'auto' } },
    }"
    @show="menuOpen = true"
    @hide="menuOpen = false"
    @keydown.esc.stop
  >
    <template #item="{ item, props: itemProps }">
      <a v-bind="itemProps.action">
        <span class="endpoint-preset">
          <span>{{ item.label }}</span>
          <small>{{ item.endpoint }}</small>
        </span>
      </a>
    </template>
  </Menu>
</template>

<script setup lang="ts">
import { computed, ref, type ComponentPublicInstance } from "vue";
import Button from "primevue/button";
import InputGroup from "primevue/inputgroup";
import InputText from "primevue/inputtext";
import Menu from "primevue/menu";
import { useI18n } from "../composables/i18n";
import { inputFieldDt } from "./configFieldDt";

const props = defineProps<{
  inputId: string;
  modelValue: string;
  presets: { name: string; url: string }[];
}>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();
const { t } = useI18n();
const group = ref<ComponentPublicInstance | null>(null);
const menu = ref<InstanceType<typeof Menu> | null>(null);
const menuOpen = ref(false);
const items = computed(() => props.presets.map((preset) => ({
  label: preset.name,
  endpoint: preset.url,
  command: () => emit("update:modelValue", preset.url),
})));
</script>

<style scoped>
.endpoint-preset {
  display: grid;
  gap: 0.125rem;
}
.endpoint-preset small {
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
</style>
