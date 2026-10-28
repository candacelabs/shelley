import { expect, test } from "@playwright/test";

test("expired exe.dev login reloads into the auth flow", async ({ page }) => {
  await page.addInitScript(() => {
    class TestEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;

      readyState = TestEventSource.CONNECTING;
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(_url: string | URL) {
        (window as Window & { __testStream?: TestEventSource }).__testStream = this;
        queueMicrotask(() => {
          this.readyState = TestEventSource.OPEN;
          this.onopen?.();
        });
      }

      close() {
        this.readyState = TestEventSource.CLOSED;
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: TestEventSource,
    });
  });

  await page.goto("/new#keep-my-place");
  await expect(page.getByTestId("message-input")).toBeVisible();

  await page.route("**/api/upload/raw", (route) =>
    route.fulfill({
      status: 307,
      headers: { location: "/__exe.dev/login?redirect=%2Fnew" },
    }),
  );

  const reloaded = page.waitForNavigation({ waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const stream = (
      window as Window & {
        __testStream?: { readyState: number; onerror: (() => void) | null };
      }
    ).__testStream;
    if (!stream?.onerror) throw new Error("global stream was not initialized");
    stream.readyState = 0;
    stream.onerror();
  });
  await reloaded;

  expect(new URL(page.url()).hash).toBe("#keep-my-place");
  expect(await page.evaluate(() => performance.getEntriesByType("navigation")[0]?.type)).toBe(
    "reload",
  );
});
