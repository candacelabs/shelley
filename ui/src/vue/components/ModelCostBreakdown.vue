<!-- One row group shared by the main-conversation and sub-agent columns. -->
<template>
  <tbody class="token-cost-model-breakdown">
    <tr class="token-cost-model-row">
      <th scope="row">
        <span class="token-cost-model-name">{{ model.model }}</span>
      </th>
      <td v-for="scope in scopes" :key="scope" :data-scope="scope">
        <template v-if="model[scope]">
          <span
            v-if="model[scope]!.priced || model[scope]!.knownUsd > 0"
            class="token-cost-legend-cost"
          >
            {{ formatUsd(model[scope]!.knownUsd)
            }}<template v-if="model[scope]!.reportedUsd > 0">
              {{
                model[scope]!.reportedUsd === model[scope]!.knownUsd
                  ? " reported"
                  : " incl. reported"
              }}</template
            >
          </span>
          <span v-else class="token-cost-legend-unit">no pricing</span>
        </template>
        <span v-else class="token-cost-empty" aria-label="No usage">—</span>
      </td>
    </tr>
    <tr v-for="index in rowIndexes" :key="index" class="token-cost-legend-row">
      <th scope="row">
        <span
          v-if="model.main"
          class="token-cost-chip"
          :style="{ backgroundColor: model.main.rows[index].color }"
        />
        <span class="token-cost-legend-label">{{ bands[index].label }}</span>
      </th>
      <td v-for="scope in scopes" :key="scope" :data-scope="scope">
        <TokenCostCell v-if="model[scope]" :row="model[scope]!.rows[index]" />
        <span v-else class="token-cost-empty" aria-label="No usage">—</span>
      </td>
    </tr>
  </tbody>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  formatUsd,
  TOKEN_BANDS as bands,
  type ModelCostComparison,
} from "../../utils/tokenCostGraph";
import TokenCostCell from "./TokenCostCell.vue";

const props = defineProps<{
  model: ModelCostComparison;
  showSubagents: boolean;
  hideZeroCacheWrite: boolean;
}>();
const scopes = computed(() =>
  props.showSubagents ? (["main", "subagents"] as const) : (["main"] as const),
);
const rowIndexes = computed(() =>
  bands
    .map((_, index) => index)
    .filter(
      (index) =>
        !(
          props.hideZeroCacheWrite &&
          bands[index].costKey === "cache_write" &&
          scopes.value.every((scope) => (props.model[scope]?.rows[index].tokens ?? 0) === 0)
        ),
    )
    .reverse(),
);
</script>
