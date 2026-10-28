import { test, expect } from "@playwright/test";
import { createConversationViaAPI } from "./helpers";

// Issue #260: mobile users have no keyboard shortcut for the Cmd/Ctrl+K
// command palette, so the overflow exposes a "Command menu" button. The
// Playwright project runs the Pixel 5 mobile viewport, matching the mobile use case.
test.describe("Command palette from overflow", () => {
  test("overflow button opens the command palette", async ({ page, request }) => {
    test.setTimeout(60000);

    const slug = await createConversationViaAPI(request, "Hello");
    await page.goto(`/c/${slug}`);
    await page.waitForLoadState("domcontentloaded");

    // The palette starts closed.
    await expect(page.locator(".command-palette-input")).toHaveCount(0);

    await page.getByRole("button", { name: "More options", exact: true }).tap();
    const menu = page.locator(".chat-overflow-popover");
    const button = menu.getByRole("button", { name: /^Command menu\b/ });
    await expect(button).toBeVisible();
    await expect(button.locator(".overflow-menu-shortcut")).toBeHidden();
    await button.tap();
    await expect(menu).toBeHidden();

    // The palette opens and behaves like the keyboard-opened one.
    const search = page.locator(".command-palette-input");
    await expect(search).toBeVisible();
    await search.fill("notification");
    const firstCommand = page.locator(".command-palette-item").first();
    await expect(firstCommand).toBeVisible();
    await expect(firstCommand.locator(".command-palette-item-title")).toHaveCSS(
      "font-size",
      "16px",
    );

    // Escape closes it again.
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
  });
});
