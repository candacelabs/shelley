<!-- Picks the favicon emoji with emoji-picker-element, as exe.dev's own VM
     emoji picker (ui/src/components/EmojiPicker.vue) does: search, click, done.
     When exe.dev supplies the VM's emoji it wins, so this only links there. -->
<template>
  <div v-if="isOpen" class="command-palette-overlay" @click="emit('close')">
    <div
      ref="popoverRef"
      class="favicon-emoji-popover"
      role="dialog"
      tabindex="-1"
      :aria-label="t('faviconEmoji')"
      @click.stop
    >
      <div v-if="busy" class="favicon-emoji-status">{{ t("faviconEmojiSaving") }}</div>
      <div v-else-if="error" class="favicon-emoji-status error" role="alert">{{ error }}</div>
      <div v-else-if="!current" class="favicon-emoji-status">{{ t("loading") }}</div>
      <div v-if="current?.source === 'exe.dev'" class="favicon-emoji-status">
        {{ t("faviconEmojiFromExe") }}
        <a :href="`https://exe.dev/vm/${vmName}`" target="_blank" rel="noopener noreferrer">{{
          t("faviconEmojiChangeOnExe")
        }}</a>
      </div>
      <component
        :is="'emoji-picker'"
        v-else-if="current"
        ref="pickerRef"
        class="favicon-emoji-picker"
        :class="isDark ? 'dark' : 'light'"
        @emoji-click="onEmojiClick"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import "emoji-picker-element";
import { popModalEscape, pushModalEscape } from "../composables/modalEscapeStack";
import { faviconEmojiApi, type FaviconEmoji } from "../../services/api";
import { setFaviconHref } from "../../services/favicon";
import { useI18n } from "../composables/i18n";

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();
const { t } = useI18n();

const current = ref<FaviconEmoji | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const isDark = ref(false);
const popoverRef = ref<HTMLElement | null>(null);
const pickerRef = ref<HTMLElement | null>(null);
const vmName = computed(() => (window.__SHELLEY_INIT__?.hostname ?? "").split(".")[0]);

// Each opening is a session; async results only touch the session that asked.
// Opening waits for any in-flight save so its GET cannot return the old emoji.
let session = 0;
let saving: Promise<void> = Promise.resolve();

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const close = () => emit("close");

// emoji-picker-element emits 'emoji-click' with { detail: { unicode, emoji, ... } }
function onEmojiClick(ev: Event) {
  const detail = (ev as CustomEvent).detail;
  const unicode: string | undefined = detail?.unicode || detail?.emoji?.unicode;
  if (!unicode || busy.value) return;
  const seq = session;
  busy.value = true;
  error.value = null;
  saving = faviconEmojiApi
    .set(unicode)
    .then(
      (fe) => {
        setFaviconHref(fe.href);
        if (seq === session) close();
      },
      (e) => {
        if (seq === session) error.value = message(e);
      },
    )
    .finally(() => {
      busy.value = false;
    });
}

watch(
  () => props.isOpen,
  async (open) => {
    // Escape goes through the shared modal stack, so it closes the picker
    // wherever focus is, as it does for every other modal.
    popModalEscape(close);
    if (!open) return;
    pushModalEscape(close);
    const seq = ++session;
    current.value = null;
    error.value = null;
    isDark.value = document.documentElement.classList.contains("dark");
    // Hold focus here until the picker loads, so early keystrokes don't land
    // in the message input behind it.
    await nextTick();
    popoverRef.value?.focus();
    await saving;
    try {
      const fe = await faviconEmojiApi.get();
      if (seq !== session) return;
      current.value = fe;
      setFaviconHref(fe.href);
    } catch (e) {
      if (seq === session) error.value = message(e);
      return;
    }
    await nextTick();
    // Focus the picker's internal search input if available.
    pickerRef.value?.shadowRoot?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  },
  { immediate: true },
);
onBeforeUnmount(() => popModalEscape(close));
</script>
