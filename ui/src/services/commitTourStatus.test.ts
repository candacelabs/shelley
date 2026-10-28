import assert from "node:assert/strict";
import {
  applyCommitTourStatus,
  loadCommitTourStatus,
  subscribeCommitTourStatus,
} from "./commitTourStatus";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const originalFetch = globalThis.fetch;

try {
  const pending = deferred<Response>();
  globalThis.fetch = (async () => pending.promise) as typeof globalThis.fetch;
  const seen: string[] = [];
  const unsubscribe = subscribeCommitTourStatus("/tmp/stale", "abc1234", (status) =>
    seen.push(status.status),
  );
  const load = loadCommitTourStatus("/tmp/stale", "abc1234", true);
  applyCommitTourStatus("/tmp/stale", "abc1234", {
    status: "building",
    hash: "abc1234",
    repository: "/tmp/stale/.git",
  });
  pending.resolve(
    Response.json({
      status: "absent",
      hash: "abcdef0123456789abcdef0123456789abcdef01",
      repository: "/tmp/stale/.git",
    }),
  );
  const result = await load;
  assert.equal(result.status, "building", "stale caller must receive the newer request state");
  assert.equal(seen.at(-1), "building", "stale GET must not replace a newer request state");
  unsubscribe();

  const aliasHash = "1234567890abcdef1234567890abcdef12345678";
  globalThis.fetch = (async () =>
    Response.json({
      status: "absent",
      hash: aliasHash,
      repository: "/tmp/alias-race/.git",
    })) as typeof globalThis.fetch;
  await loadCommitTourStatus("/tmp/alias-race", "1234567", true);
  let aliasRaceState = "";
  const unsubscribeAliasRace = subscribeCommitTourStatus("/tmp/alias-race", "1234567", (status) => {
    aliasRaceState = status.status;
  });
  const pendingAlias = deferred<Response>();
  globalThis.fetch = (async () => pendingAlias.promise) as typeof globalThis.fetch;
  const aliasLoad = loadCommitTourStatus("/tmp/alias-race/worktree", aliasHash, true);
  applyCommitTourStatus("/tmp/alias-race", "1234567", {
    status: "building",
    hash: aliasHash,
    repository: "/tmp/alias-race/.git",
    worker_slug: "tour-worker",
  });
  pendingAlias.resolve(
    Response.json({
      status: "absent",
      hash: aliasHash,
      repository: "/tmp/alias-race/.git",
    }),
  );
  const aliasResult = await aliasLoad;
  assert.equal(aliasResult.status, "building", "stale alias callers must receive newer state");
  assert.equal(aliasRaceState, "building", "stale alias GET must not fan out over a request");
  unsubscribeAliasRace();

  let successorState = "";
  const firstDisposer = subscribeCommitTourStatus("/tmp/disposer", "feed123", () => {});
  firstDisposer();
  const successorDisposer = subscribeCommitTourStatus("/tmp/disposer", "feed123", (status) => {
    successorState = status.status;
  });
  firstDisposer();
  applyCommitTourStatus("/tmp/disposer", "feed123", {
    status: "building",
    hash: "feed123",
    repository: "/tmp/disposer/.git",
  });
  assert.equal(successorState, "building", "old disposers must not remove successor listeners");
  successorDisposer();

  globalThis.fetch = (async () =>
    Response.json({
      status: "absent",
      hash: "abcdef0123456789abcdef0123456789abcdef01",
      repository: "/tmp/alias/.git",
    })) as typeof globalThis.fetch;
  await loadCommitTourStatus("/tmp/alias", "abcdef0", true);
  let aliased = "";
  const unsubscribeAlias = subscribeCommitTourStatus("/tmp/alias", "abcdef0", (status) => {
    aliased = status.status;
  });
  applyCommitTourStatus("/tmp/alias/subdir", "abcdef0123456789abcdef0123456789abcdef01", {
    status: "building",
    hash: "abcdef0123456789abcdef0123456789abcdef01",
    repository: "/tmp/alias/.git",
    worker_slug: "tour-worker",
  });
  assert.equal(aliased, "building", "canonical status must update short-hash worktree aliases");
  unsubscribeAlias();
} finally {
  globalThis.fetch = originalFetch;
}
