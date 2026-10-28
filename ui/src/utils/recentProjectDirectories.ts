import type { ConversationWithState } from "../types";

export interface RecentProjectDirectory {
  name: string;
  path: string;
  updatedAt: string;
}

export interface RecentProjectGroup {
  name: string;
  root: string;
  directories: RecentProjectDirectory[];
}

const RECENT_PROJECT_LIMIT = 12;
export const OTHER_ROOT = "";
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

function updatedNanoseconds(updatedAt: string): bigint {
  const milliseconds = Date.parse(updatedAt);
  if (!Number.isFinite(milliseconds)) throw new Error(`invalid updated_at: ${updatedAt}`);
  const fraction = updatedAt.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] || "";
  const submillisecond = BigInt((fraction.slice(3) + "000000").slice(0, 6));
  return BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND + submillisecond;
}

function basename(path: string): string {
  const withoutTrailingSlashes = path.replace(/\/+$/, "");
  return withoutTrailingSlashes.slice(withoutTrailingSlashes.lastIndexOf("/") + 1) || path;
}

export function recentProjectGroups(
  conversations: readonly ConversationWithState[],
): RecentProjectGroup[] {
  const seenDirectories = new Set<string>();
  const groupsByRoot = new Map<string, RecentProjectGroup>();
  const groups: RecentProjectGroup[] = [];
  let directoryCount = 0;
  const meaningful = conversations
    .filter(
      (conversation) =>
        !conversation.is_draft &&
        conversation.parent_conversation_id === null &&
        conversation.max_sequence_id > 0 &&
        !!conversation.cwd?.trim(),
    )
    .map((conversation) => ({
      conversation,
      updatedAt: updatedNanoseconds(conversation.updated_at),
    }))
    .sort((a, b) => (a.updatedAt === b.updatedAt ? 0 : a.updatedAt > b.updatedAt ? -1 : 1));

  for (const { conversation } of meaningful) {
    const cwd = conversation.cwd!.trim();
    const path = conversation.git_repo_root?.trim() || cwd;
    const projectRoot = conversation.git_repo_root?.trim()
      ? conversation.git_worktree_root?.trim() || path
      : OTHER_ROOT;
    if (seenDirectories.has(path)) continue;
    seenDirectories.add(path);

    let group = groupsByRoot.get(projectRoot);
    if (!group) {
      group = {
        name: projectRoot === OTHER_ROOT ? "Other" : basename(projectRoot),
        root: projectRoot,
        directories: [],
      };
      groupsByRoot.set(projectRoot, group);
      groups.push(group);
    }
    group.directories.push({ name: basename(path), path, updatedAt: conversation.updated_at });
    directoryCount++;
    if (directoryCount === RECENT_PROJECT_LIMIT) break;
  }
  return groups.sort((a, b) => Number(a.root === OTHER_ROOT) - Number(b.root === OTHER_ROOT));
}
