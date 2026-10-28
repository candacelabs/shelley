import { expect, test } from "@playwright/test";
import { basename, dirname, join } from "node:path";
import { createConversationViaAPIWithDetails, withTempDir } from "./helpers";
import { WORKER_SERVERS_ENV, type WorkerServer } from "../scripts/worker-server";

// Editor tests write AGENTS.md in HOME, and every new conversation scans cwd
// for guidance and skills. Neither may use the runner's shared HOME or /tmp.
test("the managed server isolates its home and conversation working directory", async ({
  page,
  request,
}) => {
  test.skip(!!process.env.TEST_SERVER_URL, "External servers own their environment");
  await page.goto("/new");
  const init = await page.evaluate(() => window.__SHELLEY_INIT__!);
  expect(basename(init.default_cwd!)).toBe("cwd");
  expect(basename(init.home_dir!)).toBe("home");
  expect(dirname(init.default_cwd!)).toBe(dirname(init.home_dir!));
  expect(basename(dirname(init.default_cwd!))).toMatch(/^shelley-e2e-/);
  expect(init.user_agents_md_path).toBe(join(init.home_dir!, ".config/shelley/AGENTS.md"));

  const { conversationId } = await createConversationViaAPIWithDetails(request, "Hello");
  const response = await request.get(`/api/conversation/${conversationId}`);
  expect(response.ok()).toBeTruthy();
  const { conversation } = await response.json();
  expect(conversation.cwd).toBe(init.default_cwd);
});

// Each worker drives a server of its own (scripts/worker-server.ts). If the
// config stopped being evaluated per worker, every worker would silently fall
// back to the first server and the suite would be sharing one again.
test("each worker talks to its own managed server", async ({ page, baseURL }) => {
  test.skip(!!process.env.TEST_SERVER_URL, "External servers are shared by design");
  const servers = JSON.parse(process.env[WORKER_SERVERS_ENV]!) as WorkerServer[];
  const mine = servers[test.info().parallelIndex];
  expect(mine, `no server for worker ${test.info().parallelIndex}`).toBeDefined();
  expect(baseURL).toBe(mine.baseURL);
  expect(process.env.SHELLEY_TEST_CWD).toBe(mine.cwd);
  expect(process.env.TEST_SERVER_DB).toBe(mine.db);
  expect(process.env.TEST_SERVER_SOCKET).toBe(mine.socket);
  expect(new Set(servers.map((s) => s.baseURL)).size).toBe(servers.length);

  await page.goto("/new");
  const init = await page.evaluate(() => window.__SHELLEY_INIT__!);
  expect(init.default_cwd).toBe(mine.cwd);
});

// Tests on a worker share its server, and /new otherwise defaults to the most
// recent conversation's cwd: another test's temp dir, usually deleted by now.
// Every browser starts pinned to the worker's fixture directory instead
// (workerStorageState), so a fresh /new sends from there, wherever the test before it ran.
test("a fresh /new ignores the previous test's deleted directory", async ({ page, request }) => {
  test.skip(!!process.env.TEST_SERVER_URL, "External servers own their environment");
  await withTempDir("shelley-env-gone-", async (dir) => {
    await createConversationViaAPIWithDetails(request, "Hello", { cwd: dir });
  });
  await page.goto("/new");
  await page.getByTestId("message-input").fill("echo: still here");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".messages-container .message-agent").first()).toContainText(
    "still here",
  );
});
