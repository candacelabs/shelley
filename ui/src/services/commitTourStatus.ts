import { api, type GitTourBuildStatus } from "./api";

interface CacheEntry {
  value?: GitTourBuildStatus;
  promise?: Promise<GitTourBuildStatus>;
  expiresAt: number;
  revision: number;
}

interface CanonicalEntry {
  status: GitTourBuildStatus;
  revision: number;
}

type Listener = (status: GitTourBuildStatus) => void;
export interface CommitTourRequest {
  cwd: string;
  hash: string;
}

type RequestListener = (request: CommitTourRequest) => void;

const DEFAULT_TTL_MS = 30_000;
const BUILDING_TTL_MS = 1_000;
const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<Listener>>();
const requestListeners = new Set<RequestListener>();
const canonicalKeys = new Map<string, Set<string>>();
const keyCanonical = new Map<string, string>();
const canonicalValues = new Map<string, CanonicalEntry>();
let nextRevision = 0;

export function commitTourStatusKey(cwd: string, hash: string): string {
  return `${cwd}\u0000${hash}`;
}

function canonicalStatusKey(status: GitTourBuildStatus): string | null {
  return status.repository ? `${status.repository}\u0000${status.hash}` : null;
}

function removeKey(key: string) {
  cache.delete(key);
  const canonical = keyCanonical.get(key);
  if (!canonical) return;
  keyCanonical.delete(key);
  const keys = canonicalKeys.get(canonical);
  keys?.delete(key);
  if (keys?.size === 0) {
    canonicalKeys.delete(canonical);
    canonicalValues.delete(canonical);
  }
}

function pruneExpired(now = Date.now()) {
  for (const [key, entry] of cache) {
    if (!entry.promise && entry.expiresAt <= now && !listeners.has(key)) removeKey(key);
  }
}

function rememberCanonicalKey(key: string, status: GitTourBuildStatus) {
  const canonical = canonicalStatusKey(status);
  if (!canonical) return;
  const previous = keyCanonical.get(key);
  if (previous && previous !== canonical) {
    const keys = canonicalKeys.get(previous);
    keys?.delete(key);
    if (keys?.size === 0) {
      canonicalKeys.delete(previous);
      canonicalValues.delete(previous);
    }
  }
  keyCanonical.set(key, canonical);
  let keys = canonicalKeys.get(canonical);
  if (!keys) {
    keys = new Set();
    canonicalKeys.set(canonical, keys);
  }
  keys.add(key);
}

function publishOne(key: string, status: GitTourBuildStatus, revision: number) {
  const current = cache.get(key);
  if (current && current.revision > revision) return;
  rememberCanonicalKey(key, status);
  cache.set(key, {
    value: status,
    expiresAt: Date.now() + (status.status === "building" ? BUILDING_TTL_MS : DEFAULT_TTL_MS),
    revision,
  });
  for (const listener of listeners.get(key) ?? []) listener(status);
}

function publish(
  key: string,
  status: GitTourBuildStatus,
  revision = ++nextRevision,
): GitTourBuildStatus {
  pruneExpired();
  const canonical = canonicalStatusKey(status);
  let effective = { status, revision };
  if (canonical) {
    const current = canonicalValues.get(canonical);
    if (current && current.revision > revision) effective = current;
    else canonicalValues.set(canonical, effective);
  }

  const aliases = canonical ? [...(canonicalKeys.get(canonical) ?? [])] : [];
  publishOne(key, effective.status, effective.revision);
  for (const alias of aliases) {
    if (alias !== key) publishOne(alias, effective.status, effective.revision);
  }
  return effective.status;
}

export function subscribeCommitTourStatus(
  cwd: string,
  hash: string,
  listener: Listener,
): () => void {
  const key = commitTourStatusKey(cwd, hash);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  const cached = cache.get(key)?.value;
  if (cached) listener(cached);
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    set?.delete(listener);
    if (listeners.get(key) === set && set?.size === 0) {
      listeners.delete(key);
      pruneExpired();
    }
  };
}

export function subscribeCommitTourRequests(listener: RequestListener): () => void {
  requestListeners.add(listener);
  return () => requestListeners.delete(listener);
}

export function announceCommitTourRequest(cwd: string, hash: string) {
  for (const listener of requestListeners) listener({ cwd, hash });
}

export async function loadCommitTourStatus(
  cwd: string,
  hash: string,
  force = false,
): Promise<GitTourBuildStatus> {
  const key = commitTourStatusKey(cwd, hash);
  const now = Date.now();
  pruneExpired(now);
  let entry = cache.get(key);
  if (!force && entry?.value && entry.expiresAt > now) return entry.value;
  if (!force && entry?.promise) return entry.promise;

  const revision = ++nextRevision;
  const promise = api.getGitTourStatus(cwd, hash);
  entry = { promise, expiresAt: now, revision };
  cache.set(key, entry);
  try {
    const status = await promise;
    if (cache.get(key) !== entry) return cache.get(key)?.value ?? status;
    return publish(key, status, revision);
  } catch (error) {
    if (cache.get(key) === entry) removeKey(key);
    throw error;
  }
}

export async function requestCommitTour(
  conversationId: string,
  cwd: string,
  hash: string,
): Promise<GitTourBuildStatus> {
  const status = await api.requestGitTour(conversationId, cwd, hash);
  const published = publish(commitTourStatusKey(cwd, hash), status);
  if (published.status === "building") announceCommitTourRequest(cwd, published.hash);
  return published;
}

export function applyCommitTourStatus(cwd: string, hash: string, status: GitTourBuildStatus) {
  publish(commitTourStatusKey(cwd, hash), status);
}
