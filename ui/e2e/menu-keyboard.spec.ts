import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  closeTerminalsIn,
  createConversationViaAPIWithDetails,
  setPageTerminalRenderer,
  testWorkingDirectory,
} from "./helpers";

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

async function macPlatform(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
  });
}

function fixtureDirectory() {
  return mkdtempSync(join(testWorkingDirectory(), "menu-keyboard-"));
}

test.describe("keyboard shortcuts", () => {
  test("dialogs keep background actions and the terminal toggle out", async ({ page, request }) => {
    const cwd = fixtureDirectory();
    try {
      const { conversationId } = await createConversationViaAPIWithDetails(request, "Hello", {
        cwd,
      });
      await page.goto(`/c/${conversationId}`);
      const input = page.getByTestId("message-input");
      await input.press("Control+p");
      const dialog = page.getByRole("dialog");
      const finder = dialog.getByRole("textbox").first();
      await expect(finder).toBeFocused();
      const url = page.url();
      for (const key of [
        "Control+Shift+D",
        "Control+Shift+X",
        "Control+Backquote",
        "Alt+ArrowDown",
      ]) {
        await finder.press(key);
        await expect(dialog).toBeVisible();
        await expect(page.locator(".diff-viewer-overlay")).toHaveCount(0);
        await expect(page.locator(".terminal-panel")).toBeHidden();
      }
      await finder.press("Control+m");
      await finder.press("n");
      await expect(finder).toHaveValue("n");
      await expect(page).toHaveURL(url);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await input.press("Control+k");
      const palette = page.locator(".command-palette-input");
      await expect(palette).toBeFocused();
      await palette.press("Control+Shift+D");
      await palette.press("Control+Backquote");
      await expect(page.locator(".diff-viewer-overlay")).toHaveCount(0);
      await expect(page.locator(".terminal-panel")).toBeHidden();
      await palette.press("Control+k");
      await expect(palette).toBeHidden();

      await input.press("Control+Shift+D");
      await expect(page.locator(".diff-viewer-overlay")).toBeVisible();
      // This overlay need not move focus, so checking only event.target is insufficient.
      await input.focus();
      await input.press("Control+Backquote");
      await input.press("Control+Shift+X");
      await expect(page.locator(".terminal-panel")).toBeHidden();
      await expect(page).toHaveURL(url);
    } finally {
      await closeTerminalsIn(request, cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("already handled and composing keys do not trigger either handler", async ({ page }) => {
    await page.goto("/new");
    const input = page.getByTestId("message-input");
    await expect(input).toBeVisible();
    for (const state of ["handled", "composing", "safari-composing"]) {
      await input.evaluate((element, state) => {
        for (const [key, code, shiftKey] of [
          ["D", "KeyD", true],
          ["k", "KeyK", false],
          ["p", "KeyP", false],
          ["m", "KeyM", false],
          ["`", "Backquote", false],
        ] as const) {
          const event = new KeyboardEvent("keydown", {
            key,
            code,
            shiftKey,
            ctrlKey: true,
            bubbles: true,
            cancelable: true,
            isComposing: state === "composing",
            keyCode: state === "safari-composing" ? 229 : 0,
          });
          if (state === "handled") event.preventDefault();
          element.dispatchEvent(event);
        }
      }, state);
      await expect(page.locator(".diff-viewer-overlay, .command-palette-overlay")).toHaveCount(0);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".terminal-panel")).toBeHidden();
    }
    await input.press("n");
    await expect(input).toHaveValue("n");
    await input.press("Control+k");
    await expect(page.locator(".command-palette-input")).toBeVisible();
  });

  test("text fields and menus respect local key handlers", async ({ page, request }) => {
    const cwd = fixtureDirectory();
    try {
      const { conversationId } = await createConversationViaAPIWithDetails(request, "Hello", {
        cwd,
      });
      await page.goto(`/c/${conversationId}`);
      const input = page.getByTestId("message-input");
      await input.fill("keep this draft");
      await page.evaluate(() => {
        for (const tag of ["input", "div"]) {
          const field = document.createElement(tag);
          if (tag === "div") field.contentEditable = "true";
          field.id = `terminal-shortcut-${tag}`;
          field.style.cssText = "position:fixed;top:0;left:0;width:100px;height:30px;z-index:9999";
          document.body.append(field);
        }
      });
      for (const selector of [
        '[data-testid="message-input"]',
        "#terminal-shortcut-input",
        "#terminal-shortcut-div",
      ]) {
        const field = page.locator(selector);
        await field.press("Control+Shift+D");
        await expect(page.locator(".diff-viewer-overlay")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".diff-viewer-overlay")).toHaveCount(0);
        await field.evaluate((element) => {
          (element as HTMLElement).onkeydown = (event) => {
            if (event.code === "Backquote") event.preventDefault();
          };
        });
        await field.press("Control+Backquote");
        await expect(page.locator(".terminal-panel-tab")).toHaveCount(0);
        await expect(field).toBeFocused();
        await field.evaluate((element) => {
          (element as HTMLElement).onkeydown = null;
        });
        await field.press("Control+Backquote");
        const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
        await expect(terminalInput).toBeFocused();
        await expect(page.locator(".terminal-panel-tab")).toHaveCount(1);
        await terminalInput.press("Control+Backquote");
        await expect(input).toBeFocused();
        await page.getByRole("button", { name: "Close terminal", exact: true }).click();
        await expect(page.locator(".terminal-panel-tab")).toHaveCount(0);
      }
      await expect(input).toHaveValue("keep this draft");
      await page.getByRole("button", { name: "More options", exact: true }).click();
      await expect(page.locator(".chat-overflow-popover")).toBeVisible();
      await page.keyboard.press("Control+Shift+D");
      await expect(page.locator(".diff-viewer-overlay")).toBeVisible();
    } finally {
      await closeTerminalsIn(request, cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a foreign terminal does not swallow opening the current one", async ({ page, request }) => {
    await setPageTerminalRenderer(page, "ghostty");
    const cwd = fixtureDirectory();
    try {
      const first = await createConversationViaAPIWithDetails(request, "First", { cwd });
      await page.goto(`/c/${first.conversationId}`);
      await page.getByTestId("message-input").press("Control+Backquote");
      await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(1);
      const second = await createConversationViaAPIWithDetails(request, "Second", { cwd });
      await page.goto(`/c/${second.conversationId}`);
      await expect(page.locator(".terminal-panel")).toBeHidden();
      await page.getByTestId("message-input").press("Control+Backquote");
      await expect(
        page.getByRole("textbox", { name: "Terminal input", exact: true }),
      ).toBeFocused();
      await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(1);
      await expect
        .poll(async () => {
          const terminals: Array<{ conversation_id: string }> = await (
            await request.get("/api/terminals")
          ).json();
          return terminals.filter((t) => t.conversation_id === second.conversationId).length;
        })
        .toBe(1);
    } finally {
      await closeTerminalsIn(request, cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  for (const renderer of ["ghostty", "xterm"] as const) {
    test(`Mac Command shortcuts still reach Shelley from the terminal (${renderer})`, async ({
      page,
      request,
    }) => {
      await setPageTerminalRenderer(page, renderer);
      await macPlatform(page);
      const cwd = fixtureDirectory();
      try {
        const { conversationId } = await createConversationViaAPIWithDetails(request, "Hello", {
          cwd,
        });
        await page.goto(`/c/${conversationId}`);
        const input = page.getByTestId("message-input");
        await expect(input).toBeEnabled();
        await input.press("Control+Backquote");
        const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
        await expect(terminalInput).toBeFocused();
        await terminalInput.press("Meta+k");
        const palette = page.locator(".command-palette-input");
        await expect(palette).toBeFocused();
        await palette.press("Meta+k");
        await expect(palette).toHaveCount(0);
        await terminalInput.press("Meta+Shift+D");
        await expect(page.locator(".diff-viewer-overlay")).toBeVisible();
        await input.focus();
        await page.keyboard.press("Escape");
        await expect(page.locator(".diff-viewer-overlay")).toHaveCount(0);
      } finally {
        await closeTerminalsIn(request, cwd);
        rmSync(cwd, { recursive: true, force: true });
      }
    });

    test.describe(`terminal toggle (${renderer})`, () => {
      test.use({ hasTouch: true });
      test("keeps the selected tab and restores hardware-keyboard focus", async ({
        page,
        request,
      }) => {
        await setPageTerminalRenderer(page, renderer);
        const cwd = fixtureDirectory();
        try {
          const { conversationId } = await createConversationViaAPIWithDetails(request, "Hello", {
            cwd,
          });
          await page.goto(`/c/${conversationId}`);
          const input = page.getByTestId("message-input");
          await expect(input).toBeEnabled();
          await input.press("Control+Backquote");
          const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
          const selectedView = page.locator("[data-terminal-id]:visible");
          await expect(terminalInput).toBeFocused();
          await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(1);
          const firstId = await selectedView.getAttribute("data-terminal-id");
          await page.getByRole("button", { name: "New terminal", exact: true }).click();
          await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(2);
          await expect(terminalInput).toBeFocused();
          await page.locator(".terminal-panel-tab").first().click();
          await expect(selectedView).toHaveAttribute("data-terminal-id", firstId!);
          await input.focus();
          await page.keyboard.down("Control");
          await page.keyboard.down("Backquote");
          await expect(terminalInput).toBeFocused();
          await expect(selectedView).toHaveAttribute("data-terminal-id", firstId!);
          await page.keyboard.down("Backquote");
          await expect(page.locator(".terminal-panel")).not.toHaveClass(/terminal-panel-minimized/);
          await expect(terminalInput).toBeFocused();
          await page.keyboard.up("Backquote");
          await page.keyboard.up("Control");
          await terminalInput.press("Control+Backquote");
          await expect(page.locator(".terminal-panel")).toHaveClass(/terminal-panel-minimized/);
          await expect(input).toBeFocused();
          await input.press("Control+Backquote");
          await expect(terminalInput).toBeFocused();
          await expect(selectedView).toHaveAttribute("data-terminal-id", firstId!);
          await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(2);
        } finally {
          await closeTerminalsIn(request, cwd);
          rmSync(cwd, { recursive: true, force: true });
        }
      });
    });

    test(`shell control keys arrive, but the toggle does not (${renderer})`, async ({
      page,
      request,
    }) => {
      await setPageTerminalRenderer(page, renderer);
      const cwd = fixtureDirectory();
      try {
        // Keep the fixture alive until explicit cleanup.
        writeFileSync(
          join(cwd, "keys.sh"),
          "stty raw -echo\nprintf ready > ready\nIFS= read -r -d q keys\nstty sane\nprintf '%s' \"$keys\" | od -An -tx1 > received\nread -r\n",
        );
        const { conversationId } = await createConversationViaAPIWithDetails(request, "Hello", {
          cwd,
        });
        await page.goto(`/c/${conversationId}`);
        const input = page.getByTestId("message-input");
        await input.fill("!bash keys.sh");
        await page.getByTestId("send-button").click();
        const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
        await expect.poll(() => existsSync(join(cwd, "ready"))).toBe(true);
        await input.press("Control+Backquote");
        await expect(terminalInput).toBeFocused();
        for (const key of ["Control+k", "Control+b"]) {
          await terminalInput.press(key);
          await expect(page.locator(".command-palette-overlay")).toHaveCount(0);
        }
        await terminalInput.press("Control+Backquote");
        await expect(input).toBeFocused();
        await input.press("Control+Backquote");
        await expect(terminalInput).toBeFocused();
        await input.press("Control+Shift+D");
        await expect(page.locator(".diff-viewer-overlay")).toBeVisible();
        await terminalInput.press("Control+Backquote");
        await expect(page.locator(".terminal-panel")).not.toHaveClass(/terminal-panel-minimized/);
        await input.focus();
        await page.keyboard.press("Escape");
        await expect(page.locator(".diff-viewer-overlay")).toHaveCount(0);
        await terminalInput.press("q");
        await expect
          .poll(() =>
            existsSync(join(cwd, "received"))
              ? readFileSync(join(cwd, "received"), "utf8").trim()
              : null,
          )
          .toBe("0b 02");
      } finally {
        await closeTerminalsIn(request, cwd);
        rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
});
