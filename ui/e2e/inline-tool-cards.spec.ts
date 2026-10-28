import { test, expect } from "@playwright/test";
import { createConversationViaAPI, setPageFeatureFlag } from "./helpers";

// Tool calls always render as full-width inline cards, and the VM's reflection
// emoji is always the favicon. The two flags that used to gate those choices
// ("tool-pills", "reflection-emoji-favicon") are gone; these tests pin that
// removal down from the outside so neither can come back by accident.
const REMOVED_FLAGS = ["tool-pills", "reflection-emoji-favicon"];

test("removed feature flags are absent from the API and the flags modal", async ({
  page,
  request,
}) => {
  const resp = await request.get("/feature-flags");
  expect(resp.ok()).toBeTruthy();
  const flags: { name: string }[] = await resp.json();
  // Sanity: the registry is really being served, so the absence below means
  // something.
  expect(flags.length).toBeGreaterThan(0);
  expect(flags.map((f) => f.name)).not.toContain(REMOVED_FLAGS[0]);
  expect(flags.map((f) => f.name)).not.toContain(REMOVED_FLAGS[1]);

  // And they are not offered in the UI either (the modal renders the same
  // registry; reachable via the command palette).
  const slug = await createConversationViaAPI(request, "hello");
  await page.goto(`/c/${slug}`);
  await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30000 });
  await page.keyboard.press("ControlOrMeta+k");
  const search = page.locator(".command-palette-input");
  await expect(search).toBeVisible();
  await search.fill("feature");
  await page.locator(".command-palette-item").first().click();
  await expect(page.locator(".modal-title")).toHaveText("Feature flags");
  const names = page.locator(".feature-flag-name");
  await expect(names.first()).toBeVisible();
  const rendered = await names.allTextContents();
  expect(rendered.length).toBeGreaterThan(0);
  for (const removed of REMOVED_FLAGS) expect(rendered).not.toContain(removed);
});

// A stale localStorage override from before the removal must not resurrect the
// pill row: nothing reads the flag any more, so a burst of consecutive tool
// calls still renders as inline cards.
test("a stale tool-pills override still renders bursts as inline cards", async ({
  page,
  request,
}) => {
  await setPageFeatureFlag(page, "tool-pills", true);

  // A generated conversation whose turns each contain several consecutive tool
  // calls -- the burst shape that used to collapse into one pill row.
  const generated = await request.post("/debug/loremipsum?json=1", {
    form: { size: "12", model: "predictable" },
  });
  expect(generated.ok()).toBeTruthy();
  const { conversation_id: conversationId } = await generated.json();

  await page.goto(`/c/${conversationId}`);
  await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30000 });

  // The override really is in place, so the assertions below prove it was
  // ignored rather than never written.
  expect(await page.evaluate(() => window.localStorage.getItem("ff:tool-pills"))).toBe("true");

  // Every tool call in the conversation is an inline card (or its cheap
  // geometry placeholder, for the ones far offscreen).
  const cards = page.locator(
    '[data-testid="tool-call-completed"], [data-testid="tool-call-running"]',
  );
  await expect.poll(() => cards.count(), { timeout: 30000 }).toBeGreaterThan(1);
  await expect(page.locator(".tool-pill")).toHaveCount(0);
  await expect(page.locator(".tool-pills-row")).toHaveCount(0);
  await expect(page.locator(".tool-detail-modal")).toHaveCount(0);

  // Two tool calls from the same burst sit next to each other in the stream,
  // each as its own full-width card, rather than side by side in a row.
  const firstTwo = await cards.evaluateAll((els) =>
    els.slice(0, 2).map((el) => el.getBoundingClientRect().width),
  );
  const containerWidth = await page.locator(".messages-container").evaluate((el) => el.clientWidth);
  for (const width of firstTwo) expect(width).toBeGreaterThan(containerWidth * 0.5);
});

// A tool whose whole point is its output (a patch) shows it without a click,
// and a collapsed card opens in place: no modal is involved in reading a tool
// result any more.
test("tool output is read inline, never in a modal", async ({ page, request }) => {
  const patchSlug = await createConversationViaAPI(request, "patch success");
  await page.goto(`/c/${patchSlug}`);
  const patchTool = page
    .locator('.patch-tool[data-testid="tool-call-completed"]')
    .filter({ hasText: "test-patch-success.txt" })
    .first();
  await expect(patchTool).toBeVisible({ timeout: 30000 });
  // Expanded on arrival -- no header click, no modal.
  await expect(patchTool.locator(".patch-tool-details")).toBeVisible();

  const bashSlug = await createConversationViaAPI(request, "bash: echo inline-only");
  await page.goto(`/c/${bashSlug}`);
  const bashTool = page.locator('.bash-tool[data-testid="tool-call-completed"]').first();
  await expect(bashTool).toBeVisible({ timeout: 30000 });
  await bashTool.locator(".bash-tool-header").click();
  const details = bashTool.locator(".bash-tool-details");
  await expect(details).toBeVisible();
  await expect(details).toContainText("inline-only");
  // Expanded in place, inside the card that was clicked, with no modal opened.
  await expect(page.locator(".modal")).toHaveCount(0);
  await expect(page.locator(".tool-detail-modal")).toHaveCount(0);
});
