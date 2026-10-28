import { test, expect } from "@playwright/test";
import { createConversationViaAPI } from "./helpers";

for (const exitCode of [0, 7]) {
  test(`bash exit ${exitCode} is shown only in the expanded output header`, async ({
    page,
    request,
  }) => {
    // Printing a fake status must not affect the real exit code in the header.
    const slug = await createConversationViaAPI(
      request,
      `bash: printf '[command failed: exit status 99]\\nkept output\\n'; exit ${exitCode}`,
    );
    await page.goto(`/c/${slug}`);
    const card = page.locator('.bash-tool[data-testid="tool-call-completed"]').first();
    await expect(card).toBeVisible({ timeout: 30000 });
    const header = card.locator(".bash-tool-header");
    await expect(header.locator(".tool-status-icon")).toHaveCount(0);
    await expect(header).not.toContainText(/[✓✗]/);
    await expect(card.locator(".bash-tool-details")).toHaveCount(0);

    await header.click();
    const label = card.locator(".bash-tool-label").filter({ hasText: "Output" });
    await expect(label).toContainText(`Output (exit code ${exitCode}):`);
    await expect(card.locator(".bash-tool-details")).toContainText("kept output");
    await expect(card.locator(".bash-tool-time")).toBeVisible();

    await header.click();
    await expect(card.locator(".bash-tool-details")).toHaveCount(0);
    await page.reload();
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(header.locator(".tool-status-icon")).toHaveCount(0);
    await header.click();
    await expect(label).toContainText(`Output (exit code ${exitCode}):`);
  });
}

// The job wrapper records a signal death as the shell does: 128 + signal.
test("a signal failure reports the shell exit status", async ({ page, request }) => {
  const slug = await createConversationViaAPI(request, "bash: kill -TERM $$");
  await page.goto(`/c/${slug}`);
  const card = page.locator('.bash-tool[data-testid="tool-call-completed"]').first();
  await expect(card).toBeVisible({ timeout: 30000 });
  const header = card.locator(".bash-tool-header");
  await expect(header.locator(".tool-status-icon")).toHaveCount(0);
  await header.click();
  const label = card.locator(".bash-tool-label").filter({ hasText: "Output" });
  await expect(label).toContainText("Output (exit code 143):");
  await expect(card.locator(".bash-tool-details")).toContainText("exit status 143");
});

test("non-bash cards keep error details without header status marks", async ({ page, request }) => {
  const slug = await createConversationViaAPI(request, "change_dir: /nonexistent-tool-status-dir");
  await page.goto(`/c/${slug}`);
  const card = page.locator('.tool[data-testid="tool-call-completed"]').first();
  await expect(card).toBeVisible({ timeout: 30000 });
  const header = card.locator(".tool-header");
  await expect(header.locator(".tool-status-icon")).toHaveCount(0);
  await expect(header).not.toContainText(/[✓✗]/);
  await header.click();
  await expect(card.locator(".tool-details")).toContainText("Result (Error):");
  await expect(card.locator(".tool-details")).toContainText("directory does not exist");
});
