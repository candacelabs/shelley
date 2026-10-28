import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chooseTerminalMenuItem,
  closeTerminalsIn,
  createConversationViaAPIWithDetails,
  testWorkingDirectory,
} from "./helpers";

// The terminal panel keeps its copy and insert actions in one menu.
test("the terminal menu copies and inserts the output", async ({ page, request, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const cwd = mkdtempSync(join(testWorkingDirectory(), "terminal-menu-"));
  try {
    writeFileSync(join(cwd, "t.sh"), "seq -f 'early-%g' 200\necho menu-ready\nexec cat\n");
    const { conversationId } = await createConversationViaAPIWithDetails(
      request,
      "terminal menu test",
      { cwd },
    );
    await page.goto(`/c/${conversationId}`);
    const input = page.getByTestId("message-input");
    await input.fill("!bash t.sh");
    await page.getByTestId("send-button").click();
    await expect(page.locator(".terminal-panel-tab-running")).toBeVisible();

    const trigger = page.getByRole("button", { name: "Terminal menu", exact: true });
    const menu = page.locator(".overflow-menu-panel");
    await trigger.click();
    await expect(menu.getByRole("button")).toHaveText([
      "Copy visible screen",
      "Copy all output",
      "Insert visible screen into input",
      "Insert all output into input",
      "Show key shortcuts",
      "Render with ghostty",
      "Render with xterm.js",
    ]);
    await trigger.click();
    await expect(menu).toBeHidden();

    const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
    await expect
      .poll(async () => (await chooseTerminalMenuItem(page, "Copy visible screen"), clipboard()))
      .toContain("menu-ready");
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveClass(/terminal-panel-action-btn-feedback/);
    expect(await clipboard()).not.toContain("early-1\n");

    await chooseTerminalMenuItem(page, "Copy all output");
    await expect.poll(clipboard).toContain("early-1\n");

    await chooseTerminalMenuItem(page, "Insert visible screen into input");
    await expect(input).toHaveValue(/menu-ready/);
    await expect(input).not.toHaveValue(/early-1\n/);
    await input.fill("");
    await chooseTerminalMenuItem(page, "Insert all output into input");
    await expect(input).toHaveValue(/early-1\n[^]*menu-ready/);
  } finally {
    await closeTerminalsIn(request, cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("the terminal menu works from the keyboard and closes with the panel", async ({
  page,
  request,
}) => {
  const cwd = mkdtempSync(join(testWorkingDirectory(), "terminal-menu-"));
  try {
    const { conversationId } = await createConversationViaAPIWithDetails(
      request,
      "terminal menu keyboard test",
      { cwd },
    );
    await page.goto(`/c/${conversationId}`);
    await page.getByTestId("message-input").fill("!bash");
    await page.getByTestId("send-button").click();
    await expect(page.locator(".terminal-panel-tab-running")).toBeVisible();

    const trigger = page.getByRole("button", { name: "Terminal menu", exact: true });
    const menu = page.locator(".overflow-menu-panel");
    const item = (name: string) => menu.getByRole("button", { name, exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(item("Copy visible screen")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(item("Copy all output")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // Copy visible screen
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    // The shell ends, and its tab and the panel go: so does the menu.
    const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
    await terminalInput.pressSequentially("while [ ! -e go ]; do sleep 0.05; done; exit");
    await terminalInput.press("Enter");
    await trigger.click();
    await expect(menu).toBeVisible();
    writeFileSync(join(cwd, "go"), "");
    await expect(page.locator(".terminal-panel")).toBeHidden();
    await expect(menu).toBeHidden();
  } finally {
    await closeTerminalsIn(request, cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ghostty-web draws terminals unless the menu says xterm.js. Switching
// reopens running terminals, and the server replays their screens.
test("the terminal menu switches renderers and remembers the choice", async ({ page, request }) => {
  const cwd = mkdtempSync(join(testWorkingDirectory(), "terminal-menu-"));
  try {
    writeFileSync(join(cwd, "t.sh"), "echo before-switch\nexec cat\n");
    const { conversationId } = await createConversationViaAPIWithDetails(
      request,
      "terminal renderer test",
      { cwd },
    );
    await page.goto(`/c/${conversationId}`);
    const input = page.getByTestId("message-input");
    await input.fill("!bash t.sh");
    await page.getByTestId("send-button").click();
    await expect(page.locator(".terminal-panel-tab-running")).toBeVisible();

    const terminal = page.locator(
      '.terminal-panel-content [data-terminal-id][style*="display: block"]',
    );
    const menu = page.locator(".overflow-menu-panel");
    const renderer = async () => {
      await page.getByRole("button", { name: "Terminal menu", exact: true }).click();
      const pressed = menu.locator('[aria-pressed="true"]');
      const label = await pressed.innerText();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      return label.trim();
    };
    const output = async () => {
      await input.fill("");
      await chooseTerminalMenuItem(page, "Insert all output into input");
      return input.inputValue();
    };
    const typeLine = async (text: string) => {
      const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
      await terminalInput.pressSequentially(text);
      await terminalInput.press("Enter");
    };

    // ghostty-web paints a canvas; xterm.js renders into an .xterm element.
    expect(await renderer()).toBe("Render with ghostty");
    await expect(terminal.locator("canvas")).toHaveCount(1);
    await expect(terminal.locator(".xterm")).toHaveCount(0);

    await chooseTerminalMenuItem(page, "Render with xterm.js");
    await expect(terminal.locator(".xterm")).toHaveCount(1);
    await expect.poll(output).toContain("before-switch");
    await typeLine("typed-in-xterm");
    await expect.poll(output).toMatch(/typed-in-xterm\n[^]*typed-in-xterm/);

    await page.reload();
    await expect(page.locator(".terminal-panel-tab-running")).toBeVisible();
    await expect(terminal.locator(".xterm")).toHaveCount(1);
    expect(await renderer()).toBe("Render with xterm.js");

    await chooseTerminalMenuItem(page, "Render with ghostty");
    await expect(terminal.locator(".xterm")).toHaveCount(0);
    await expect(terminal.locator("canvas")).toHaveCount(1);
    await expect.poll(output).toContain("typed-in-xterm");
    await typeLine("typed-in-ghostty");
    await expect.poll(output).toMatch(/typed-in-ghostty\n[^]*typed-in-ghostty/);
  } finally {
    await closeTerminalsIn(request, cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});
