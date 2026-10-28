import { expect, test } from "@playwright/test";
import type { LLMMessage, Message } from "../src/types";
import { createConversationViaAPIWithDetails } from "./helpers";

for (const { hasError, searchTerms } of [
  { hasError: false, searchTerms: ["auth", "handler"] },
  { hasError: true, searchTerms: ["auth", "handler"] },
  { hasError: false, searchTerms: "auth, handler" },
]) {
  test(`historical keyword_search renders ${hasError ? "failed" : "successful"} results (${typeof searchTerms === "string" ? "string" : "array"} terms)`, async ({
    page,
    request,
  }) => {
    const registry = await request.get("/api/tools");
    expect(registry.ok()).toBeTruthy();
    const { tools } = await registry.json();
    expect(tools.map((tool: { name: string }) => tool.name)).not.toContain("keyword_search");

    const { conversationId, slug } = await createConversationViaAPIWithDetails(
      request,
      "bash: echo historical-search",
    );
    const query = "find authentication handlers";
    const output = hasError ? "Search failed: directory not found" : "src/auth.ts:42: handleLogin";

    // Replay a stored call/result pair without reintroducing an executable tool.
    await page.route("**/api/stream2*", (route) => route.abort());
    await page.route(`**/api/conversation/${conversationId}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { messages: Message[] };
      for (const message of body.messages) {
        if (!message.llm_data) continue;
        const data: LLMMessage = JSON.parse(message.llm_data);
        for (const content of data.Content || []) {
          if (content.Type === 5) {
            content.ToolName = "keyword_search";
            content.ToolInput = { query, search_terms: searchTerms };
          } else if (content.Type === 6) {
            content.ToolResult = [{ ID: "historical-search-result", Type: 2, Text: output }];
            content.ToolError = hasError;
            content.ToolUseStartTime = "2026-01-01T00:00:00Z";
            content.ToolUseEndTime = "2026-01-01T00:00:01Z";
          }
        }
        message.llm_data = JSON.stringify(data);
      }
      await route.fulfill({ response, json: body });
    });

    await page.goto(`/c/${slug}`);
    const card = page.locator('.tool[data-testid="tool-call-completed"]').filter({
      has: page.locator(".tool-command", { hasText: query }),
    });
    await expect(card).toBeVisible();
    await expect(card.locator(".tool-emoji")).toHaveText("🔍");
    await expect(card.locator(".tool-header .tool-status-icon")).toHaveCount(0);
    await expect(card.locator(".tool-header")).not.toContainText(/[✓✗]/);
    await expect(card.locator(".tool-details")).toBeHidden();

    await card.locator(".tool-header").click();
    await page.mouse.move(0, 0);
    await expect(page.locator("[data-action-bar]")).toHaveCount(0);
    await expect(card.locator(".tool-code")).toHaveText([query, "auth, handler", output]);
    await expect(card.locator(".tool-time")).toHaveText("1.0s");
    await expect(card.locator(".tool-label").last()).toContainText(
      hasError ? "Results (Error):" : "Results:",
    );
    await expect(card.locator(".tool-code.error")).toHaveCount(hasError ? 1 : 0);

    await card.getByRole("button", { name: "Collapse", exact: true }).click();
    await expect(card.locator(".tool-details")).toBeHidden();
  });
}
