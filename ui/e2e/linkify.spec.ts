import { test, expect } from "@playwright/test";
import { createConversationViaAPI } from "./helpers";

// Test that URLs in agent responses are properly linkified.
// With markdown enabled (default), agent messages render via Marked which
// auto-links URLs. With markdown disabled, linkifyText adds .text-link spans.

test("URLs in agent responses are linked (markdown mode)", async ({ page }) => {
  await page.goto('/new');
  await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30000 });

  await page.getByTestId("message-input").fill(
    "echo: Check https://example.com and https://test.com",
  );
  await page.getByTestId("send-button").click();

  await page.waitForSelector(".message-agent", { timeout: 30000 });

  // Markdown renderer auto-links URLs into <a> tags inside .markdown-content
  const agentLinks = page.locator(".message-agent .markdown-content a");
  await expect(agentLinks.first()).toBeVisible();
  await expect(agentLinks.first()).toHaveAttribute("href", "https://example.com");
  await expect(agentLinks.first()).toHaveAttribute("target", "_blank");
  await expect(agentLinks.first()).toHaveAttribute("rel", "noopener noreferrer");

  await expect(agentLinks.nth(1)).toBeVisible();
  await expect(agentLinks.nth(1)).toHaveAttribute("href", "https://test.com");
});

test("URLs are linkified in user messages too", async ({ page }) => {
  await page.goto('/new');
  await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30000 });

  await page.getByTestId("message-input").fill("echo: Visit https://example.com");
  await page.getByTestId("send-button").click();

  await page.waitForSelector(".message-user", { timeout: 30000 });

  // User messages always use linkifyText (never markdown)
  const userMessage = page.locator(".message-user").filter({
    hasText: "echo: Visit https://example.com",
  });
  await expect(userMessage).toContainText("echo: Visit https://example.com");

  const link = userMessage.locator("a.text-link");
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", "https://example.com");
});

for (const layout of ["desktop", "project device"]) {
  test.describe(layout, () => {
    // Otherwise inherit the project's device (Pixel 5 in the default project).
    if (layout === "desktop") {
      test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
    }

    test("standalone inline-code URLs are clickable", async ({ page, request, context }) => {
      const url = "https://example.com/preview?q=one&other=two#fragment";
      const slug = await createConversationViaAPI(
        request,
        [
          "markdown: Preview: `" + url + "`",
          "Command: `curl https://example.com/command`",
          "Two URLs: `https://one.example https://two.example`",
          "Explicit link: [`https://example.com/label`](https://example.com/destination)",
          "```text\nhttps://example.com/fenced\n```",
        ].join("\n\n"),
      );
      await page.goto(`/c/${slug}`);

      const content = page.locator(".message-agent .markdown-content").last();
      const link = content.locator(`a[href="${url}"]`);
      await expect(link).toBeVisible({ timeout: 30000 });
      await expect(link.locator("code")).toHaveText(url);
      await expect(link.locator("code")).toHaveCSS("display", "inline");
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(content.locator("a")).toHaveCount(2);
      await expect(content.locator('a[href="https://example.com/destination"] code')).toHaveText(
        "https://example.com/label",
      );
      await expect(content.locator("pre code")).toHaveText("https://example.com/fenced\n");
      await expect(content.locator("pre a")).toHaveCount(0);

      // Exercise a real click without depending on an external website.
      await context.route("https://example.com/**", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: "<h1>Preview destination</h1>",
        }),
      );
      const popupPromise = page.waitForEvent("popup");
      await link.click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(url);
      await expect(popup.locator("h1")).toHaveText("Preview destination");
      expect(await popup.evaluate(() => window.opener === null)).toBe(true);
      await popup.close();
    });
  });
}
