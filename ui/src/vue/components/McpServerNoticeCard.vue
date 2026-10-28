<!-- MCP server-list changes are user messages to the model (so a working agent
     learns its external services changed) but a small system notice to the
     reader. -->
<template>
  <div class="mcp-notice-card" data-testid="mcp-notice-card">
    <svg
      class="mcp-notice-icon"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
    <span>{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
import type { McpNoticeMessageSource } from "../../utils/messageSource";

defineProps<{ source: McpNoticeMessageSource; text: string }>();
</script>

<style scoped>
.mcp-notice-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--p-surface-300, #d4d4d8);
  border-radius: 6px;
  background: var(--p-surface-50, #fafafa);
  color: var(--p-text-muted-color, #71717a);
  font-size: 0.85rem;
}
.mcp-notice-icon {
  flex-shrink: 0;
}
</style>
