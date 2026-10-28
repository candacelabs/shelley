<!-- Vue port of components/DiffFileTree.tsx. File tree for the diff viewer
     sidebar. Preserves the diff-tree-* class contract, role="tree"/"treeitem",
     aria-label "Files"/"Filter files", and the status letters. Emits
     "select" with the realPath (React onSelect prop). With `ordered`, files
     render flat in entry order (commit highlights rank them) below the
     commit-messages folder. Also exports COMMIT_MESSAGES_DIR and
     treeRealPathOrder (see ./diffFileTree.ts). -->
<template>
  <div class="diff-tree">
    <div class="diff-tree-search">
      <input
        type="text"
        class="diff-tree-search-input"
        placeholder="Search…"
        :value="query"
        aria-label="Filter files"
        @input="query = ($event.target as HTMLInputElement).value"
      />
    </div>
    <div class="diff-tree-scroll" role="tree" aria-label="Files">
      <DiffTreeRows
        :rows="renderedRows"
        :selected-real-path="selectedRealPath"
        @select="onSelect"
        @toggle="toggle"
        @selected-row="(el: HTMLButtonElement | null) => (selectedRowEl = el)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import DiffTreeRows from "./DiffTreeRows.vue";
import {
  buildTree,
  flatten,
  isCommitMessageEntry,
  COMMIT_MESSAGES_DIR,
  matchTreePaths,
  normalizeSearch,
  statusLetter,
  subtreeHasMatch,
  type DiffFileTreeEntry,
  type DirNode,
  type RenderedRow,
} from "./diffFileTree";

const props = defineProps<{
  entries: DiffFileTreeEntry[];
  selectedRealPath: string | null;
  ordered?: boolean;
}>();
const emit = defineEmits<{ (e: "select", realPath: string): void }>();

function onSelect(realPath: string) {
  emit("select", realPath);
}

// Ordered lists only nest commit messages; other files render flat.
const tree = computed<DirNode>(() =>
  buildTree(props.ordered ? props.entries.filter(isCommitMessageEntry) : props.entries),
);

// Track all directory paths so we can default them open.
const allDirPaths = computed<string[]>(() => {
  const out: string[] = [];
  const walk = (d: DirNode) => {
    for (const c of d.children) {
      if (c.kind === "dir") {
        out.push(c.path);
        walk(c);
      }
    }
  };
  walk(tree.value);
  return out;
});

const expanded = ref<Set<string>>(new Set(allDirPaths.value));
// When the directory set changes (new commit, range flip), default-expand
// any newly-introduced directories without forcing back open ones the user
// has explicitly closed in this session.
const seenDirs = ref<Set<string>>(new Set(allDirPaths.value));
watch(allDirPaths, (paths) => {
  const fresh: string[] = [];
  for (const p of paths) {
    if (!seenDirs.value.has(p)) {
      fresh.push(p);
      seenDirs.value.add(p);
    }
  }
  if (fresh.length === 0) return;
  const next = new Set(expanded.value);
  for (const p of fresh) next.add(p);
  expanded.value = next;
});

// Toggle a chain of directory paths together (flattened chains share one
// open/closed surface).
function toggle(paths: string[]) {
  const prev = expanded.value;
  const allOpen = paths.every((p) => prev.has(p));
  const next = new Set(prev);
  if (allOpen) for (const p of paths) next.delete(p);
  else for (const p of paths) next.add(p);
  expanded.value = next;
}

// Search: case-insensitive substring match on the full path (see
// matchTreePaths).
const query = ref("");
const matchedPaths = computed(() => matchTreePaths(tree.value, query.value));

// When searching, force-expand every ancestor so matches are visible.
const effectiveExpanded = computed<Set<string>>(() => {
  const mp = matchedPaths.value;
  if (!mp) return expanded.value;
  const out = new Set(expanded.value);
  const walk = (d: DirNode, ancestors: string[]) => {
    for (const c of d.children) {
      if (c.kind === "file") {
        if (mp.has(c.path)) for (const a of ancestors) out.add(a);
      } else {
        walk(c, [...ancestors, c.path]);
      }
    }
  };
  walk(tree.value, []);
  return out;
});

// Flatten the (sorted, filtered) tree into a list of rows to render. This
// mirrors the React <DirRows> recursion but produces a flat array so we can
// hand it to a single recursion-free child component.
const renderedRows = computed<RenderedRow[]>(() => {
  const mp = matchedPaths.value;
  const exp = effectiveExpanded.value;
  const out: RenderedRow[] = [];
  const walk = (dir: DirNode, depth: number) => {
    for (const child of dir.children) {
      if (child.kind === "dir") {
        const { displayName, effective, pathsCovered } = flatten(child);
        if (mp && !subtreeHasMatch(child, mp)) continue;
        const isOpen = pathsCovered.every((p) => exp.has(p));
        out.push({
          kind: "dir",
          key: `d:${child.path}`,
          depth,
          isOpen,
          label: displayName,
          isPath: child.name !== COMMIT_MESSAGES_DIR,
          pathsCovered,
        });
        if (isOpen) walk(effective, depth + 1);
      } else {
        if (mp && !mp.has(child.path)) continue;
        pushFile(out, child.entry, child.path, depth, child.name);
      }
    }
  };
  walk(tree.value, 0);
  if (props.ordered) {
    const q = normalizeSearch(query.value.trim());
    for (const entry of props.entries) {
      if (isCommitMessageEntry(entry)) continue;
      const path = entry.treePath.join("/");
      if (q && !normalizeSearch(path).includes(q)) continue;
      const name = entry.treePath[entry.treePath.length - 1];
      pushFile(out, entry, path, 0, name, entry.treePath.slice(0, -1).join("/"));
    }
  }
  return out;
});

function pushFile(
  out: RenderedRow[],
  entry: DiffFileTreeEntry,
  key: string,
  depth: number,
  label: string,
  detail?: string,
) {
  out.push({
    kind: "file",
    key: `f:${key}`,
    depth,
    isSelected: entry.realPath === props.selectedRealPath,
    label,
    isPath: !isCommitMessageEntry(entry),
    detail,
    realPath: entry.realPath,
    decoration: entry.decoration,
    decorationTitle: entry.decorationTitle,
    statusInfo: statusLetter(entry.status),
    additions: entry.additions,
    deletions: entry.deletions,
    highlightCount: entry.highlightCount,
  });
}

// Keep the selected row in view when the parent moves the selection.
const selectedRowEl = ref<HTMLButtonElement | null>(null);
watch(
  () => props.selectedRealPath,
  () => {
    nextTick(() => {
      selectedRowEl.value?.scrollIntoView({ block: "nearest" });
    });
  },
);
</script>
