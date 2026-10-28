// The message_user tool: conversations with it show only the chat by default
// (the user's messages, the agent's message_user messages with their reply
// quotes and attachments, and the agent's reactions on the user's messages).
import { test, expect, type APIRequestContext } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createConversationViaAPIWithDetails,
  makePNG,
  seedLegacyCompaction,
  withTempDir,
} from "./helpers";

// Send a message and wait for the predictable model's turn to end.
async function chat(request: APIRequestContext, conversationId: string, message: string) {
  const turns = async () => {
    const resp = await request.get(`/api/conversation/${conversationId}`);
    expect(resp.ok()).toBeTruthy();
    const { messages } = await resp.json();
    return messages.filter((m: { end_of_turn?: boolean }) => m.end_of_turn).length;
  };
  const before = await turns();
  const resp = await request.post(`/api/conversation/${conversationId}/chat`, {
    data: { message, model: "predictable" },
  });
  expect(resp.ok()).toBeTruthy();
  await expect.poll(turns, { timeout: 30000 }).toBeGreaterThan(before);
}

function messageUser(input: Record<string, unknown>): string {
  return `message_user: ${JSON.stringify(input)}`;
}

test("message_user conversations show the chat", async ({ page, request }) => {
  await withTempDir("shelley-message-user-", async (dir) => {
    writeFileSync(join(dir, "chart.png"), makePNG(40, 30));
    writeFileSync(join(dir, "report.txt"), "the report");
    const { conversationId, slug } = await createConversationViaAPIWithDetails(
      request,
      "Please check the build",
      { cwd: dir, conversationOptions: { tool_overrides: { message_user: "on" } } },
    );
    const initial = await request.get(`/api/conversation/${conversationId}`);
    expect(initial.ok()).toBeTruthy();
    const { messages: initialMessages } = (await initial.json()) as {
      messages: { type: string; sequence_id: number }[];
    };
    const firstSeq = initialMessages.find((m) => m.type === "user")?.sequence_id;
    expect(firstSeq).toBeGreaterThan(0);
    await chat(
      request,
      conversationId,
      messageUser({ text: "Looking now.", reply_to: firstSeq, reaction: "👀" }),
    );
    await chat(
      request,
      conversationId,
      messageUser({
        text: "Here are the results.",
        attachments: ["chart.png", "report.txt"],
        end_turn: true,
      }),
    );
    await chat(request, conversationId, messageUser({ text: "x", reply_to: 99999999 }));

    await page.goto(`/c/${slug}`);
    const bubbles = page.getByTestId("message-user-bubble");
    await expect(bubbles).toHaveCount(2);
    await expect(bubbles.first().getByTestId("message-user-text")).toHaveText("Looking now.");
    await expect(bubbles.last().getByTestId("message-user-text")).toHaveText(
      "Here are the results.",
    );
    // The agent's own text and the refused call stay out of the chat. (Not
    // the page: the conversation list previews other tests' conversations.)
    const chatArea = page.locator(".messages-container");
    await expect(chatArea.getByText("edit predictable.go", { exact: false })).toHaveCount(0);
    await expect(chatArea.getByText("message_user failed", { exact: false })).toHaveCount(0);

    // The reaction shows on the message it reacts to.
    const asked = page.getByTestId("message").filter({ hasText: "Please check the build" }).first();
    await expect(asked.getByTestId("message-reactions")).toHaveText("👀");

    // Attachments: the image previews, the other file downloads.
    const image = bubbles.last().locator(".message-user-image img");
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40);
    const file = bubbles.last().getByTestId("message-user-file");
    await expect(file).toContainText("report.txt");
    const download = await request.get((await file.getAttribute("href"))!);
    expect(download.ok()).toBeTruthy();
    expect(await download.text()).toBe("the report");

    // The reply quote jumps to the message it replies to. Under the reduced
    // motion the tests run with, the highlight animation ends at once and
    // takes its class along: watch for the class instead.
    await asked.evaluate((el) => {
      new MutationObserver(() => {
        if (el.classList.contains("message-highlight")) el.dataset.highlighted = "1";
      }).observe(el, { attributes: true, attributeFilter: ["class"] });
    });
    await bubbles.first().getByTestId("message-user-quote").click();
    await expect(asked).toHaveAttribute("data-highlighted", "1");

    // "See All" shows everything, and sticks for message_user conversations.
    await page.locator(".chat-overflow-menu-wrapper .btn-icon").click();
    const viewOptions = page.getByTestId("conversation-view-toggle");
    const brief = viewOptions.getByRole("button", { name: "See Chat Only" });
    const seeAll = viewOptions.getByRole("button", { name: "See All" });
    await expect(brief).toHaveAttribute("aria-pressed", "true");
    await expect(
      viewOptions.getByRole("button", { name: "See End of Turn Messages Only" }),
    ).toHaveCount(0);
    await seeAll.click();
    await expect(seeAll).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(chatArea.getByText("message_user failed", { exact: false })).toBeVisible();
    await expect(page.getByTestId("message-user-bubble")).toHaveCount(2);
    await page.reload();
    await expect(chatArea.getByText("message_user failed", { exact: false })).toBeVisible();

    // A fork copies the messages with new ids: reactions and quotes still
    // find their targets, and new calls target the fork's copies.
    const resp = await request.post(`/api/conversation/${conversationId}/fork`, { data: {} });
    expect(resp.ok()).toBeTruthy();
    const fork = await resp.json();
    await chat(request, fork.conversation_id, messageUser({ reply_to: firstSeq, reaction: "🍴" }));
    await page.goto(`/c/${fork.slug}`);
    const forkAsked = page
      .getByTestId("message")
      .filter({ hasText: "Please check the build" })
      .first();
    await expect(forkAsked.getByTestId("message-reactions")).toHaveText(/👀.*🍴/s);
    await expect(page.getByTestId("message-user-quote").first()).toBeEnabled();
  });

  // Other conversations keep their own setting.
  const plain = await createConversationViaAPIWithDetails(request, "Hello");
  await page.goto(`/c/${plain.slug}`);
  await page.locator(".chat-overflow-menu-wrapper .btn-icon").click();
  const viewOptions = page.getByTestId("conversation-view-toggle");
  await expect(viewOptions.getByRole("button", { name: "See All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(viewOptions.getByRole("button", { name: "See Chat Only" })).toHaveCount(0);
});

// After a (legacy) compaction, a fork has only the carried copies of the user's
// messages: calls made before still find them, new calls can target them, and
// jumping to one expands the band it is collapsed behind.
test("message_user targets survive compaction and forks", async ({ page, request }) => {
  // Wide enough for the conversation list.
  await page.setViewportSize({ width: 1280, height: 800 });
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "Please check the build",
    { conversationOptions: { tool_overrides: { message_user: "on" } } },
  );
  const initial = await request.get(`/api/conversation/${conversationId}`);
  expect(initial.ok()).toBeTruthy();
  const { messages: initialMessages } = (await initial.json()) as {
    messages: { type: string; sequence_id: number }[];
  };
  const firstSeq = initialMessages.find((m) => m.type === "user")?.sequence_id;
  expect(firstSeq).toBeGreaterThan(0);
  await chat(
    request,
    conversationId,
    messageUser({ text: "Looking now.", reply_to: firstSeq, reaction: "👀" }),
  );
  seedLegacyCompaction(conversationId);

  const forkOf = async () => {
    const resp = await request.post(`/api/conversation/${conversationId}/fork`, { data: {} });
    expect(resp.ok()).toBeTruthy();
    return resp.json();
  };
  const fork = await forkOf();
  const otherFork = await forkOf();
  await chat(
    request,
    fork.conversation_id,
    messageUser({ text: "Still on it.", reply_to: firstSeq }),
  );

  await page.goto(`/c/${fork.slug}`);
  const band = page.getByTestId("carried-band");
  await expect(band).toHaveCount(1);
  await expect(band.getByTestId("message")).toHaveCount(0);
  await page.evaluate(() => {
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        if (el.classList?.contains("message-highlight"))
          document.body.dataset.highlighted = el.innerText;
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  });
  const reply = page.getByTestId("message-user-bubble").filter({ hasText: "Still on it." });
  await reply.getByTestId("message-user-quote").click();
  const asked = band.getByTestId("message").filter({ hasText: "Please check the build" });
  await expect(asked).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-highlighted", /Please check the build/);
  await expect(asked.getByTestId("message-reactions")).toHaveText("👀");

  // The band expanded here does not expand the same band in another
  // conversation.
  await page
    .locator(`.conversation-item[data-conversation-id="${otherFork.conversation_id}"]`)
    .click();
  await expect(page).toHaveURL(new RegExp(otherFork.slug));
  await expect(band.getByRole("button")).toHaveAttribute("aria-expanded", "false");
});
