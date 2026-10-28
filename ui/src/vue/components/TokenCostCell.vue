<template>
  <div class="token-cost-cell">
    <span class="token-cost-legend-tokens">{{ formatTokenCount(row.tokens) }}</span>
    <span v-if="row.priced" class="token-cost-legend-unit">{{
      row.unitUsdPerMtok === null ? "mixed rates" : `@ ${formatUnitPrice(row.unitUsdPerMtok)}`
    }}</span>
    <span
      v-if="row.priced || row.cost > 0"
      class="token-cost-legend-cost"
      :title="row.priced ? undefined : 'Known token cost; excludes unpriced usage'"
      >{{ row.priced ? "" : "≥" }}{{ formatUsd(row.cost) }}</span
    >
    <span v-else class="token-cost-empty" title="No token pricing">—</span>
  </div>
</template>

<script setup lang="ts">
import { formatTokenCount, formatUsd, type ModelCostColumn } from "../../utils/tokenCostGraph";
defineProps<{ row: ModelCostColumn["rows"][number] }>();

function formatUnitPrice(usdPerMtok: number): string {
  let s: string;
  if (Number.isInteger(usdPerMtok)) s = String(usdPerMtok);
  else if (usdPerMtok >= 0.1) s = usdPerMtok.toFixed(2);
  else s = usdPerMtok.toPrecision(2).replace(/\.?0+$/, "");
  return `$${s}/M`;
}
</script>
