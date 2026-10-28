import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  closeTerminalsIn,
  createConversationViaAPIWithDetails,
  testWorkingDirectory,
} from "./helpers";

// Tabs are labelled with the window title the program sets (OSC 2), like any
// terminal emulator, and the + button opens another shell.
test("terminal tabs follow the window title and + opens a shell", async ({ page, request }) => {
  const title = "a long window title that ends in tab-tail";
  const cwd = mkdtempSync(join(testWorkingDirectory(), "terminal-tabs-"));
  try {
    writeFileSync(
      join(cwd, "title.sh"),
      `printf '\\033]2;%s\\007' '${title}'\nprintf 'title-set\\n'\nexec cat\n`,
    );
    const { conversationId } = await createConversationViaAPIWithDetails(
      request,
      "terminal tabs test",
      { cwd },
    );
    await page.goto(`/c/${conversationId}`);
    await page.getByTestId("message-input").fill("!bash title.sh");
    await page.getByTestId("send-button").click();

    const tabs = page.locator(".terminal-panel-tab");
    const activeTab = page.locator(".terminal-panel-tab-active");
    await expect(activeTab.locator(".terminal-panel-tab-label")).toHaveText(title);
    await expect(activeTab.locator(".terminal-panel-tab-label-tail")).toHaveText("tab-tail");
    await expect(activeTab.locator(".terminal-panel-tab-label-tail")).toBeInViewport();
    await expect(activeTab).toHaveAttribute("title", title);

    // The replayed screen carries no title; the tab remembers it.
    await page.reload();
    await expect(activeTab.locator(".terminal-panel-tab-label")).toHaveText(title);

    const newTerminal = page.getByRole("button", { name: "New terminal", exact: true });
    await expect(newTerminal).toBeInViewport();
    await newTerminal.click();
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveClass(/terminal-panel-tab-active/);
    // Keys typed before the socket opens are dropped.
    await expect(tabs.nth(1).locator(".terminal-panel-tab-running")).toBeVisible();
    const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
    await terminalInput.pressSequentially("printf '\\033]2;second\\007'; cat");
    await terminalInput.press("Enter"); // cat keeps the prompt from retitling
    await expect(activeTab.locator(".terminal-panel-tab-label")).toHaveText("second");
    await expect(tabs.nth(0).locator(".terminal-panel-tab-label")).toHaveText(title);
  } finally {
    await closeTerminalsIn(request, cwd);
    rmSync(cwd, { recursive: true, force: true });
  }
});
