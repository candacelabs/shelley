import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import {
  openWorkspaceTool,
  createConversationViaAPIWithDetails,
  setPageTerminalRenderer,
} from "./helpers";

// At 1x the WebGL renderer rounds cells to whole pixels (8px rather than the
// DOM renderer's 8.4px), so the two renderers fit different column counts.
test.use({ deviceScaleFactor: 1 });

async function openTerminal(page: Page, request: APIRequestContext) {
  // The WebGL renderer is xterm.js's; ghostty-web always draws to a canvas.
  await setPageTerminalRenderer(page, "xterm");
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal webgl test",
  );
  await page.goto(`/c/${conversationId}`);
  await openWorkspaceTool(page, "Terminal");
  const terminal = page.locator(
    '.terminal-panel-content [data-terminal-id][style*="display: block"]',
  );
  await expect(terminal).toBeVisible({ timeout: 30000 });
  return terminal;
}

test("renders the terminal with WebGL and falls back to the DOM on context loss", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const cols: number[] = [];
    Object.defineProperty(window, "__terminalCols", { value: cols });
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && data.startsWith("{")) {
        const message = JSON.parse(data);
        if (message.type === "init" || message.type === "resize") cols.push(message.cols);
      }
      Reflect.apply(send, this, [data]);
    };
  });
  const lastCols = () =>
    page.evaluate(() =>
      (window as typeof window & { __terminalCols: number[] }).__terminalCols.at(-1),
    );

  const terminal = await openTerminal(page, request);

  // The WebGL renderer replaces the DOM renderer's rows with a canvas.
  const webglCanvases = () =>
    terminal.evaluate(
      (el) => [...el.querySelectorAll("canvas")].filter((c) => c.getContext("webgl2")).length,
    );
  await expect.poll(webglCanvases).toBe(1);
  await expect(terminal.locator(".xterm-rows")).toHaveCount(0);
  await expect.poll(lastCols).toBeGreaterThan(0);
  const webglCols = (await lastCols())!;

  // A context that is not restored (too many live contexts) must not leave
  // the terminal blank: xterm waits briefly for a restore, then the DOM
  // renderer takes over and the terminal refits to its wider cells.
  await terminal.evaluate((el) => {
    for (const c of el.querySelectorAll("canvas")) {
      c.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
    }
  });
  await expect(terminal.locator(".xterm-rows")).toBeVisible({ timeout: 10000 });
  await expect(terminal.locator(".xterm-rows")).toContainText("$");
  expect(await webglCanvases()).toBe(0);
  await expect.poll(lastCols).toBeLessThan(webglCols);
});

test("renders the terminal with the DOM without WebGL2", async ({ page, request }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      return type === "webgl2" ? null : Reflect.apply(getContext, this, [type, ...args]);
    };
  });
  const terminal = await openTerminal(page, request);
  await expect(terminal.locator(".xterm-rows")).toContainText("$");
});
