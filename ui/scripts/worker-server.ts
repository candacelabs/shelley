// Per-worker Shelley servers for the Playwright suite.
//
// global-setup.ts starts one server per worker and publishes them all in
// WORKER_SERVERS_ENV. Workers inherit the runner's environment, and
// Playwright evaluates playwright.config.ts again in each worker process with
// TEST_PARALLEL_INDEX set (0..workers-1, kept when a worker is replaced after
// a failure). The config calls selectWorkerServer(), which points the usual
// variables -- PLAYWRIGHT_TEST_BASE_URL (the baseURL fixture), SHELLEY_TEST_CWD,
// TEST_SERVER_DB and TEST_SERVER_SOCKET -- at that worker's own server, so
// specs and helpers need no changes. test-environment.spec.ts checks that the
// selection actually happened.

export const WORKER_SERVERS_ENV = "SHELLEY_E2E_WORKER_SERVERS";

export interface WorkerServer {
  baseURL: string;
  cwd: string;
  db: string;
  socket: string;
}

export function useWorkerServer(server: WorkerServer) {
  process.env.PLAYWRIGHT_TEST_BASE_URL = server.baseURL;
  process.env.SHELLEY_TEST_CWD = server.cwd;
  process.env.TEST_SERVER_DB = server.db;
  process.env.TEST_SERVER_SOCKET = server.socket;
}

export function selectWorkerServer() {
  const servers = process.env[WORKER_SERVERS_ENV];
  const index = process.env.TEST_PARALLEL_INDEX;
  // Not a worker, or an external TEST_SERVER_URL that every worker shares.
  if (!servers || index === undefined) return;
  const list = JSON.parse(servers) as WorkerServer[];
  const server = list[Number(index)];
  if (!server) {
    throw new Error(`worker ${index} has no Shelley server; global setup started ${list.length}`);
  }
  useWorkerServer(server);
}

// Every test's browser starts with the worker's fixture directory as the
// new-conversation cwd. Without it /new falls back to the most recent
// conversation's cwd, which is whatever the previous test on this worker's
// server used -- often a temp dir it has since deleted, so the first send
// fails cwd validation. Tests that care set their own (it is only the initial
// storage, not re-applied on navigation).
export function workerStorageState() {
  const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL;
  const cwd = process.env.SHELLEY_TEST_CWD;
  if (!baseURL || !cwd) return undefined;
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [{ name: "shelley_selected_cwd", value: cwd }],
      },
    ],
  };
}
