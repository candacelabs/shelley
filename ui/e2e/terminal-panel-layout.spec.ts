import { test, expect } from "@playwright/test";
import {
  openWorkspaceTool,
  createConversationViaAPIWithDetails,
  setPageTerminalRenderer,
} from "./helpers";

test("contains shortcut overscroll while keeping the row scrollable", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("shelley-terminal-key-shortcuts", "true");
  });
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto("/new");
  await openWorkspaceTool(page, "Terminal");

  const shortcuts = page.getByRole("group", { name: "Terminal key shortcuts" });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).toHaveCSS("overscroll-behavior-x", "contain");
  await expect
    .poll(() => shortcuts.evaluate((row) => row.scrollWidth - row.clientWidth))
    .toBeGreaterThan(0);
  await shortcuts.evaluate((row) => {
    row.scrollLeft = row.scrollWidth;
  });
  await expect.poll(() => shortcuts.evaluate((row) => row.scrollLeft)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Close active terminal", exact: true }).click();
});

for (const renderer of ["ghostty", "xterm"] as const) {
  test(`terminal fits above a tall phone keyboard (${renderer})`, async ({ page }) => {
    await setPageTerminalRenderer(page, renderer);
    await page.setViewportSize({ width: 393, height: 851 });
    await page.goto("/new");
    await openWorkspaceTool(page, "Terminal");
    const panel = page.locator(".terminal-panel");
    const screen = panel.locator(
      renderer === "ghostty" ? "canvas:visible" : ".xterm-screen:visible",
    );
    await expect(screen).toBeVisible();
    const originalHeight = (await panel.boundingBox())!.height;

    // Android's resizes-content viewport policy makes a tall keyboard (or
    // landscape) reduce the layout viewport. Both the grid and its input
    // must remain reachable, then recover their chosen height on dismissal.
    await page.setViewportSize({ width: 393, height: 320 });
    await expect(async () => {
      const box = (await screen.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(320);
      const composer = (await page.getByTestId("message-input").boundingBox())!;
      expect(composer.y + composer.height).toBeLessThanOrEqual(320);
    }).toPass({ timeout: 5000 });
    await page.setViewportSize({ width: 393, height: 851 });
    await expect.poll(async () => (await panel.boundingBox())!.height).toBe(originalHeight);
    await page.getByRole("button", { name: "Close active terminal", exact: true }).click();
  });
}

test("keeps the terminal inside its padded content area", async ({ page, request }) => {
  await page.addInitScript(() => {
    const sizeMessages: Array<{ type: string; cols: number; rows: number }> = [];
    Object.defineProperty(window, "__terminalSizeMessages", { value: sizeMessages });
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        try {
          const message = JSON.parse(data);
          if (message.type === "init" || message.type === "resize") {
            sizeMessages.push(message);
          }
        } catch {
          // Non-JSON terminal input is irrelevant to this layout test.
        }
      }
      Reflect.apply(send, this, [data]);
    };
  });

  const terminalSizeMessages = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & {
            __terminalSizeMessages: Array<{ type: string; cols: number; rows: number }>;
          }
        ).__terminalSizeMessages,
    );

  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal panel layout test",
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/c/${conversationId}`);

  await openWorkspaceTool(page, "Terminal");

  const terminal = page.locator(
    '.terminal-panel-content [data-terminal-id][style*="display: block"]',
  );
  await expect(terminal).toBeVisible({ timeout: 30000 });

  const expectTerminalInsideContent = async () => {
    await expect
      .poll(async () =>
        terminal.evaluate((el) => {
          const terminalRect = el.getBoundingClientRect();
          const contentRect = el.parentElement!.getBoundingClientRect();
          // xterm adds its screen after the container shows; poll until then.
          const screen = el.querySelector(".xterm-screen, canvas");
          if (!screen) return null;
          const screenRect = screen.getBoundingClientRect();
          return {
            terminalBottom: terminalRect.bottom <= contentRect.bottom,
            terminalRight: terminalRect.right <= contentRect.right,
            screenBottom: screenRect.bottom <= terminalRect.bottom,
            screenRight: screenRect.right <= terminalRect.right,
          };
        }),
      )
      .toEqual({
        terminalBottom: true,
        terminalRight: true,
        screenBottom: true,
        screenRight: true,
      });
  };

  await expectTerminalInsideContent();
  await expect
    .poll(
      async () =>
        (await terminalSizeMessages()).find((message) => message.type === "init")?.cols ?? 0,
    )
    .toBeGreaterThan(0);
  const initialCols = (await terminalSizeMessages()).find(
    (message) => message.type === "init",
  )!.cols;

  await page.getByLabel("Minimize terminals").click();
  await expect(terminal).not.toBeVisible();
  await page.setViewportSize({ width: 900, height: 720 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
  await page.evaluate(() => {
    (
      window as typeof window & {
        __terminalSizeMessages: Array<{ type: string; cols: number; rows: number }>;
      }
    ).__terminalSizeMessages.length = 0;
  });
  await page.getByLabel("Expand terminals").click();
  await expect(terminal).toBeVisible();

  await expectTerminalInsideContent();
  await expect
    .poll(
      async () =>
        (await terminalSizeMessages()).findLast((message) => message.type === "resize")?.cols ??
        initialCols,
    )
    .toBeLessThan(initialCols);
});
