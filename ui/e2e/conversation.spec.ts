import { test, expect, type Page } from "@playwright/test";
import { createConversationViaAPI } from "./helpers";

// This conversation's messages, not the whole page: the drawer previews the
// other conversations on the worker's server, which say the same things. A
// reply that calls a tool is a .message-tool, so match anything not the user's.
const agentReply = (page: Page, text: string) =>
  page
    .locator('.messages-container [data-testid="message"]:not(.message-user)')
    .filter({ hasText: text })
    .first();
const userMessage = (page: Page, text: string) =>
  page.locator(".messages-container .message-user").filter({ hasText: text }).first();

test.describe("Shelley Conversation Tests", () => {
  test("can send Hello and get greeting response", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    // Wait for the message input using improved selector
    const messageInput = page.getByTestId("message-input");
    await expect(messageInput).toBeVisible({ timeout: 30000 });

    // Send "Hello" and expect specific predictable response
    await messageInput.fill("Hello");

    // Find and click the send button using improved selector
    const sendButton = page.getByTestId("send-button");
    await expect(sendButton).toBeVisible();
    await sendButton.click();

    // Wait for the response from the predictable model
    // The predictable model responds to "Hello" with "Hello! I'm Shelley, your AI assistant. How can I help you today?"
    await expect(
      agentReply(page, "Hello! I'm Shelley, your AI assistant. How can I help you today?"),
    ).toBeVisible({ timeout: 30000 });

    // Verify both the user message and assistant response are visible
    await expect(userMessage(page, "Hello")).toBeVisible();
  });

  test("can use echo command", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    // Send "echo: test message" and expect echo response
    await messageInput.fill("echo: test message");
    await sendButton.click();

    // The predictable model should echo back "test message"
    await expect(agentReply(page, "test message")).toBeVisible({ timeout: 30000 });

    // Verify both input and output messages are visible
    await expect(userMessage(page, "echo: test message")).toBeVisible();
  });

  test("responds differently to lowercase hello", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    // Send "hello" (lowercase) and expect different response
    await messageInput.fill("hello");
    await sendButton.click();

    // The predictable model responds to "hello" with "Well, hi there!"
    await expect(agentReply(page, "Well, hi there!")).toBeVisible({ timeout: 30000 });
  });

  test("shows thinking indicator while awaiting response", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    // Use a deliberate delay so the indicator exists long enough to observe.
    await messageInput.fill("delay: 2");
    await sendButton.click();

    const thinkingIndicator = page.getByTestId("agent-thinking");
    await expect(thinkingIndicator).toBeVisible({ timeout: 5000 });

    await expect(agentReply(page, "Delayed for 2 seconds")).toBeVisible({ timeout: 30000 });

    await expect(thinkingIndicator).toBeHidden({ timeout: 10000 });
  });

  test("shows thinking indicator on follow-up messages", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    await messageInput.fill("hello");
    await sendButton.click();

    await expect(agentReply(page, "Well, hi there!")).toBeVisible({ timeout: 30000 });

    // Use delay command so the thinking indicator is visible long enough to test
    await messageInput.fill("delay: 2");
    await sendButton.click();

    const thinkingIndicator = page.getByTestId("agent-thinking");
    await expect(thinkingIndicator).toBeVisible({ timeout: 5000 });

    await expect(agentReply(page, "Delayed for 2 seconds")).toBeVisible({ timeout: 30000 });

    await expect(thinkingIndicator).toBeHidden({ timeout: 10000 });
  });

  test("can use bash tool", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    // Send a message that triggers tool use
    await messageInput.fill('bash: echo "hello world"');
    await sendButton.click();

    // The predictable model should use the bash tool and show the response
    await expect(agentReply(page, 'I\'ll run the command: echo "hello world"')).toBeVisible({
      timeout: 30000,
    });

    // Verify tool usage appears in the UI with coalesced tool call
    await expect(page.locator('[data-testid="tool-call-completed"]').first()).toBeVisible({
      timeout: 10000,
    });
    // Check that the tool name "bash" is visible
    await expect(page.locator("text=bash").first()).toBeVisible();
  });

  test("gives default response for undefined messages", async ({ page, request }) => {
    // Create the conversation via API so we avoid a race between the initial
    // SSE Subscribe and the agent message being published.
    const slug = await createConversationViaAPI(request, "this is an undefined message");
    await page.goto(`/c/${slug}`);
    await page.waitForLoadState("domcontentloaded");

    // Verify the undefined message and default response are visible
    await expect(
      agentReply(page, "edit predictable.go to add a response for that one..."),
    ).toBeVisible({ timeout: 30000 });
    await expect(userMessage(page, "this is an undefined message")).toBeVisible();
  });

  test("conversation persists and displays correctly", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    // Send first message
    await messageInput.fill("Hello");
    await sendButton.click();

    // Wait for first response
    await expect(
      agentReply(page, "Hello! I'm Shelley, your AI assistant. How can I help you today?"),
    ).toBeVisible({ timeout: 30000 });

    // Send second message
    await messageInput.fill("echo: second message");
    await sendButton.click();

    // Wait for second response
    await expect(agentReply(page, "second message")).toBeVisible({ timeout: 30000 });

    // Verify both responses are still visible (conversation persists)
    await expect(
      agentReply(page, "Hello! I'm Shelley, your AI assistant. How can I help you today?"),
    ).toBeVisible();
    await expect(agentReply(page, "second message")).toBeVisible();
  });

  // Enter sends only where there is no touch; on a touch device it is a
  // newline, and the send button sends (MessageInput.handleKeyDown). The
  // project emulates a phone, so this test opts out of touch.
  test.describe("without touch", () => {
    test.use({ hasTouch: false });

    test("can send message with Enter key", async ({ page }) => {
      await page.goto("/new");
      await page.waitForLoadState("domcontentloaded");

      const messageInput = page.getByTestId("message-input");
      await expect(messageInput).toBeVisible({ timeout: 30000 });

      await messageInput.fill("Hello");
      await messageInput.press("Enter");

      await expect(
        agentReply(page, "Hello! I'm Shelley, your AI assistant. How can I help you today?"),
      ).toBeVisible({ timeout: 30000 });
    });
  });

  test("handles think tool correctly", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    // Send a message that triggers think tool
    await messageInput.fill("think: I need to analyze this problem");
    await sendButton.click();

    // The predictable model should return thinking content and text response
    await expect(agentReply(page, "I've considered my approach.")).toBeVisible({ timeout: 30000 });

    // Verify thinking content appears in the UI (rendered as .thinking-content with 💭 emoji, not a tool call)
    await expect(page.locator('[data-testid="thinking-content"]').first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=💭").first()).toBeVisible();
  });

  test("handles patch tool correctly", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    // Send a message that triggers patch tool
    await messageInput.fill("patch: test.txt");
    await sendButton.click();

    // The predictable model should use the patch tool
    await expect(agentReply(page, "I'll patch the file: test.txt")).toBeVisible({ timeout: 30000 });

    // Verify patch tool usage appears in the UI
    await expect(page.locator('[data-testid="tool-call-completed"]').first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=patch").first()).toBeVisible();
  });

  test("displays tool results with collapsible details", async ({ page }) => {
    await page.goto("/new");
    await page.waitForLoadState("domcontentloaded");

    const messageInput = page.getByTestId("message-input");
    const sendButton = page.getByTestId("send-button");

    // Send a bash command that will show tool results
    await messageInput.fill('bash: echo "testing tool results"');
    await sendButton.click();

    // Wait for the tool call to appear
    await expect(page.locator('[data-testid="tool-call-completed"]').first()).toBeVisible({
      timeout: 30000,
    });

    // Check for bash tool header (collapsible element)
    const bashToolHeader = page.locator(".bash-tool-header");
    await expect(bashToolHeader.first()).toBeVisible({ timeout: 10000 });
  });
});
