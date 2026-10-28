import { test, expect, type Page } from "@playwright/test";

const lowDisk = {
  kind: "disk",
  episode_id: 7,
  revision: 3,
  active: true,
  critical: false,
  dismissed: false,
  available_bytes: 1_600_000_000,
  total_bytes: 79_000_000_000,
  stall_percent: 0,
};

const highMemory = {
  ...lowDisk,
  kind: "memory",
  episode_id: 2,
  revision: 5,
  available_bytes: 1_200_000_000,
  total_bytes: 16_762_000_000,
  stall_percent: 41.7,
};

// mockStream answers every /api/stream2 connection like the server: one frame
// per status from statuses(), then a heartbeat, which completes the resource
// snapshot. The mocked body ends right away, so the client reconnects
// about a second later, and once it knows the conversation list hash the URL
// gains a query string; both must hit the mock, or the real server's statuses
// replace the ones under test.
async function mockStream(page: Page, statuses: () => object[]) {
  await page.route(
    (url) => url.pathname === "/api/stream2",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: statuses()
          .map((status) => ({ resource_status: status }))
          .concat({ heartbeat: true })
          .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
          .join(""),
      });
    },
  );
}

async function forceExeDev(page: Page) {
  await page.addInitScript(() => {
    let init: Record<string, unknown> | undefined;
    Object.defineProperty(window, "__SHELLEY_INIT__", {
      configurable: true,
      get: () => init,
      set: (value) => {
        init = { ...value, is_exe_dev: true, hostname: "myvm.exe.xyz" };
      },
    });
  });
}

test.describe("Resource notices", () => {
  test("shows disk status and dismisses the current episode", async ({ page }) => {
    let current = lowDisk;
    await mockStream(page, () => [current]);

    let dismissedEpisode: number | undefined;
    await page.route("**/api/resources/disk/dismiss", async (route) => {
      dismissedEpisode = route.request().postDataJSON().episode_id;
      current = { ...lowDisk, revision: 4, dismissed: true };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(current),
      });
    });

    await page.goto("/");

    const notice = page.getByTestId("disk-notice");
    await expect(notice).toBeVisible({ timeout: 30000 });
    await expect(notice).toContainText("Disk space is low");
    await expect(notice).toContainText("1.6 GB remaining");
    await expect(page.getByTestId("disk-notice-title")).toHaveAttribute("role", "status");

    await page.getByTestId("disk-notice-dismiss").click();

    await expect.poll(() => dismissedEpisode).toBe(lowDisk.episode_id);
    await expect(notice).toHaveCount(0);
  });

  test("links disk, not memory, to an exe.dev resize on exe.dev hosts", async ({ page }) => {
    await forceExeDev(page);
    await mockStream(page, () => [lowDisk, highMemory]);

    await page.goto("/");

    const diskLink = page.getByTestId("disk-notice-link");
    await expect(diskLink).toHaveText("Resize this VM", { timeout: 30000 });
    await expect(diskLink).toHaveAttribute(
      "href",
      "https://exe.dev/suggest?command=resize%20myvm%20--disk%3D90GB",
    );
    await expect(page.getByTestId("memory-notice")).toBeVisible();
    await expect(page.getByTestId("memory-notice-link")).toHaveCount(0);
  });

  test("announces critical status as an alert", async ({ page }) => {
    await mockStream(page, () => [{ ...lowDisk, critical: true, available_bytes: 400_000_000 }]);

    await page.goto("/");

    const notice = page.getByTestId("disk-notice");
    await expect(notice).toBeVisible({ timeout: 30000 });
    await expect(notice).toContainText("Disk space is critically low");
    await expect(page.getByTestId("disk-notice-title")).toHaveAttribute("role", "alert");
  });

  test("shows memory pressure beside disk and dismisses it alone", async ({ page }) => {
    let memory = highMemory;
    await mockStream(page, () => [lowDisk, memory]);
    let dismissed: string | undefined;
    await page.route("**/api/resources/*/dismiss", async (route) => {
      dismissed = new URL(route.request().url()).pathname;
      memory = { ...highMemory, revision: 6, dismissed: true };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(memory),
      });
    });

    await page.goto("/");

    const notice = page.getByTestId("memory-notice");
    await expect(notice).toBeVisible({ timeout: 30000 });
    await expect(notice).toContainText("Memory pressure is high");
    await expect(notice).toContainText("1.2 GB available");
    await expect(notice).toContainText("42% stalled");
    await expect(page.getByTestId("memory-notice-title")).toHaveAttribute("role", "status");

    await page.getByTestId("memory-notice-dismiss").click();

    await expect.poll(() => dismissed).toBe("/api/resources/memory/dismiss");
    await expect(notice).toHaveCount(0);
    await expect(page.getByTestId("disk-notice")).toBeVisible();
  });

  test("announces critical memory pressure as an alert", async ({ page }) => {
    await mockStream(page, () => [{ ...highMemory, critical: true, available_bytes: 300_000_000 }]);

    await page.goto("/");

    const notice = page.getByTestId("memory-notice");
    await expect(notice).toBeVisible({ timeout: 30000 });
    await expect(notice).toContainText("Memory pressure is critical");
    await expect(notice).toContainText("300 MB available");
    await expect(page.getByTestId("memory-notice-title")).toHaveAttribute("role", "alert");
  });

  test("drops a notice whose kind a reconnect no longer reports", async ({ page }) => {
    // E.g. a restarted server whose memory monitor could not start.
    let statuses = [lowDisk, highMemory];
    await mockStream(page, () => statuses);

    await page.goto("/");

    await expect(page.getByTestId("memory-notice")).toBeVisible({ timeout: 30000 });
    statuses = [lowDisk];
    await expect(page.getByTestId("memory-notice")).toHaveCount(0, { timeout: 30000 });
    await expect(page.getByTestId("disk-notice")).toBeVisible();
  });

  test("omits the stall share when nothing is stalled", async ({ page }) => {
    // Kernels without PSI report zero, as does memory that is short but not yet contended.
    await mockStream(page, () => [{ ...highMemory, stall_percent: 0.4 }]);

    await page.goto("/");

    const notice = page.getByTestId("memory-notice");
    await expect(notice).toContainText("1.2 GB available", { timeout: 30000 });
    await expect(notice).not.toContainText("stalled");
  });
});
