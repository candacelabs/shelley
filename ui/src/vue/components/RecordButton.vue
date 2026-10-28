<!-- Composer record button. A click records voice. When screen capture is
     available, hovering or long-pressing reveals Voice and Voice & Screen, so
     a screen recording takes one chooser instead of voice-then-restart. -->
<template>
  <div
    ref="rootRef"
    class="message-record"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
    @keydown.esc="close"
  >
    <button
      ref="buttonRef"
      type="button"
      :disabled="!canRecordAudio"
      class="message-voice-btn"
      :aria-label="t('recordingTitle')"
      :title="screenAvailable ? undefined : `${t('recordingTitle')} (${menuShortcutLabel('recordAudio')})`"
      data-testid="voice-button"
      @pointerdown="onPointerDown"
      @pointerup="cancelLongPress"
      @pointercancel="cancelLongPress"
      @pointerleave="cancelLongPress"
      @contextmenu="onContextMenu"
      @click="onClick"
    >
      <svg
        v-if="screenAvailable"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        data-testid="voice-video-icon"
      >
        <rect x="3" y="5" width="13" height="14" rx="2" />
        <path stroke-linecap="round" stroke-linejoin="round" d="m16 10 5-3v10l-5-3z" />
      </svg>
      <svg
        v-else
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        data-testid="voice-microphone-icon"
      >
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path stroke-linecap="round" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
      </svg>
    </button>
    <div
      v-if="open"
      ref="menuRef"
      class="queue-menu record-menu"
      role="group"
      :aria-label="t('recordingTitle')"
      data-testid="record-menu"
    >
      <button
        v-for="option in options"
        :key="option.mode"
        type="button"
        class="queue-menu-item"
        :aria-label="option.label"
        :data-testid="`record-menu-${option.mode}`"
        @click="choose(option.mode)"
      >
        <svg
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <template v-if="option.mode === 'screen'">
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path stroke-linecap="round" d="M8 20h8M12 16v4" />
          </template>
          <template v-else>
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path stroke-linecap="round" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
          </template>
        </svg>
        {{ option.label }}
        <span class="overflow-menu-shortcut" aria-hidden="true"><kbd>{{ option.shortcut }}</kbd></span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "../composables/i18n";
import { menuShortcutLabel } from "../../utils/menuShortcuts";
import type { RecordingMode } from "./recordingDestination";

const props = defineProps<{
  canRecordAudio: boolean;
  screenAvailable: boolean;
}>();
const emit = defineEmits<{
  // Emitted synchronously from the click so getDisplayMedia keeps the gesture.
  (e: "record", mode: RecordingMode): void;
}>();
const { t } = useI18n();

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 250;
const LONG_PRESS_MS = 450;

const rootRef = ref<HTMLDivElement | null>(null);
const buttonRef = ref<HTMLButtonElement | null>(null);
const menuRef = ref<HTMLDivElement | null>(null);
const open = ref(false);
const menuEnabled = computed(() => props.screenAvailable && props.canRecordAudio);
const options = computed(() =>
  (["microphone", "screen"] as const).map((mode) => ({
    mode,
    label: mode === "screen" ? t("recordingVoiceScreenOption") : t("recordingVoiceOption"),
    shortcut: menuShortcutLabel(mode === "screen" ? "recordScreen" : "recordAudio"),
  })),
);

let hoverTimer: number | undefined;
let pressTimer: number | undefined;
let touchPress = false;
// A touch long press may end in a click on the button; it must not record.
let suppressClick = false;

function clearHoverTimer() {
  window.clearTimeout(hoverTimer);
  hoverTimer = undefined;
}

function show() {
  clearHoverTimer();
  if (menuEnabled.value) open.value = true;
}

function close() {
  clearHoverTimer();
  cancelLongPress();
  suppressClick = false;
  // Removing the menu must not drop keyboard focus to <body>.
  if (menuRef.value?.contains(document.activeElement)) buttonRef.value?.focus();
  open.value = false;
}

// Pointer (not mouse) events: iOS emulates mouseenter on tap, and showing
// content from it can swallow the tap's click.
function onPointerEnter(event: PointerEvent) {
  if (event.pointerType !== "mouse" || !menuEnabled.value) return;
  clearHoverTimer();
  if (!open.value) hoverTimer = window.setTimeout(show, HOVER_OPEN_MS);
}

function onPointerLeave(event: PointerEvent) {
  if (event.pointerType !== "mouse") return;
  clearHoverTimer();
  if (open.value) hoverTimer = window.setTimeout(close, HOVER_CLOSE_MS);
}

function onFocusIn(event: FocusEvent) {
  if ((event.target as HTMLElement).matches(":focus-visible")) show();
}

function onFocusOut(event: FocusEvent) {
  const next = event.relatedTarget as Node | null;
  if (next && rootRef.value?.contains(next)) return;
  if (!rootRef.value?.matches(":hover")) close();
}

// Mice get the menu from hover; long press is for touch and pen.
function onPointerDown(event: PointerEvent) {
  suppressClick = false;
  touchPress = event.pointerType !== "mouse";
  if (!touchPress || event.button !== 0 || !menuEnabled.value) return;
  cancelLongPress();
  pressTimer = window.setTimeout(() => {
    pressTimer = undefined;
    suppressClick = true;
    show();
  }, LONG_PRESS_MS);
}

function cancelLongPress() {
  window.clearTimeout(pressTimer);
  pressTimer = undefined;
}

// Touch long-press raises the context menu / callout; the menu replaces it.
function onContextMenu(event: MouseEvent) {
  if (touchPress && menuEnabled.value) event.preventDefault();
}

function onClick(event: MouseEvent) {
  // detail is 0 for keyboard-activated clicks, which are never long presses.
  if (suppressClick && event.detail !== 0) {
    suppressClick = false;
    return;
  }
  choose("microphone");
}

function choose(mode: RecordingMode) {
  close();
  emit("record", mode);
}

function onOutsidePointerDown(event: PointerEvent) {
  if (!rootRef.value?.contains(event.target as Node)) close();
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener("pointerdown", onOutsidePointerDown, true);
  else document.removeEventListener("pointerdown", onOutsidePointerDown, true);
});

watch(menuEnabled, (enabled) => {
  if (!enabled) close();
});

onBeforeUnmount(() => {
  close();
  document.removeEventListener("pointerdown", onOutsidePointerDown, true);
});
</script>
