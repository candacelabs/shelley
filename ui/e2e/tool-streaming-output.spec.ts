import { test, expect, type Locator } from "@playwright/test";
import { createConversationViaAPI } from "./helpers";

// While a bash tool runs, its card shows a compact preview of the streamed
// output below the header, so a long-running command is legible without
// expanding anything. The preview is transient: it disappears when the tool
// finishes and the card's own output section takes over.
test("a running bash card previews the tail of its streamed output", async ({ page, request }) => {
  const slug = await createConversationViaAPI(request, "hello");
  await page.goto(`/c/${slug}`);
  const input = page.getByTestId("message-input");
  await expect(input).toBeVisible({ timeout: 30000 });

  // Emit a new line every 200ms for ~12s: bash reports its output tail to the
  // UI every 500ms while it runs. The lines are wider than the card on the
  // default 393px-wide phone project, so they exercise wrapping/clipping.
  await input.fill(
    "bash: /opt/toolchain/bin/some-really-long-builder-name --flag; " +
      'for i in $(seq 1 60); do echo "tick-$i compiling a rather long module name ... ok"; sleep 0.2; done',
  );
  await page.getByTestId("send-button").click();

  // The conversation's only tool call, so it can be tracked across states.
  const card = page.locator(".bash-tool");
  await expect(card).toHaveAttribute("data-testid", "tool-call-running", { timeout: 30000 });
  const preview = card.locator(".bash-tool-preview-code");
  await expect(preview).toHaveText(/tick-\d+/, { timeout: 30000 });

  // The command stays visible in the header while the preview streams below
  // it: what is running must not be displaced by its own output.
  await expect(card.locator(".bash-tool-command")).toContainText("some-really-long-builder-name");

  // The preview tracks the newest line rather than sticking at the first one,
  // and shows only the tail (5 lines) with a way to see the rest. Reads 0 once
  // the tool finishes (the preview is replaced by the completed card), which
  // fails the poll promptly and legibly instead of hanging on a detached node.
  const newestTick = async () => {
    const texts = await preview.allTextContents();
    const ticks = [...(texts[0] ?? "").matchAll(/tick-(\d+)/g)].map((m) => Number(m[1]));
    return ticks.length > 0 ? Math.max(...ticks) : 0;
  };
  const first = await newestTick();
  await expect.poll(newestTick, { timeout: 15000 }).toBeGreaterThan(first);
  const previewLines = await preview.evaluate(
    (el) => (el.textContent ?? "").split("\n").filter((l) => l.trim() !== "").length,
  );
  expect(previewLines).toBeLessThanOrEqual(5);

  // The preview clips rather than widening the conversation (the default
  // project is a 393px-wide phone, where there is no slack).
  const overflow = (l: Locator) => l.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(await overflow(page.locator(".messages-container"))).toBeLessThanOrEqual(1);
  expect(await overflow(page.locator("html"))).toBeLessThanOrEqual(1);

  // "Show all N lines" reveals everything streamed so far, in place.
  const more = card.locator(".bash-tool-preview-more");
  await expect(more).toHaveText(/Show all \d+ lines/);
  await more.click();
  await expect(more).toHaveCount(0);
  await expect
    .poll(
      () =>
        preview.evaluate(
          (el) => (el.textContent ?? "").split("\n").filter((l) => l.trim() !== "").length,
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(5);

  // Once the tool completes the preview is gone and the finished card, with
  // its own output section, takes over.
  await expect(card).toHaveAttribute("data-testid", "tool-call-completed", { timeout: 60000 });
  await expect(card.locator(".bash-tool-preview")).toHaveCount(0);
  await card.locator(".bash-tool-header").click();
  await expect(card.locator(".bash-tool-details")).toContainText("tick-60");
});
