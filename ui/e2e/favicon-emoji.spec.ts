import { expect, test, type Page } from "@playwright/test";
import type { FaviconEmoji } from "../src/services/api";

// Whether the server's favicon emoji comes from exe.dev depends on the host
// running the suite, so these tests serve /api/favicon-emoji from a fake that
// behaves like the server; the Go tests cover the real endpoint. The picker's
// emoji data normally comes from a CDN; a few entries stand in for it.
const href = (emoji: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg"><text>${emoji}</text></svg>`);

const emojiData = [
  ["🦊", "fox", 3],
  ["🐙", "octopus", 3],
  ["🌵", "cactus", 4],
].map(([emoji, annotation, order]) => ({
  annotation,
  emoji,
  group: 3,
  order,
  shortcodes: [annotation],
  tags: [annotation],
  version: 1,
}));

async function fakeServer(page: Page, initial: Omit<FaviconEmoji, "href">) {
  const puts: string[] = [];
  let current = initial;
  let failNext = false;
  // Tests can hold a PUT here to observe the UI mid-save.
  let gate: Promise<void> = Promise.resolve();
  await page.route(
    (url) => url.hostname === "cdn.jsdelivr.net",
    (route) => route.fulfill({ json: emojiData, headers: { etag: '"test"' } }),
  );
  await page.route("**/api/favicon-emoji", async (route) => {
    if (route.request().method() === "PUT") {
      const { emoji } = route.request().postDataJSON() as { emoji: string };
      puts.push(emoji);
      await gate;
      if (failNext) {
        failNext = false;
        await route.fulfill({ status: 500, body: "Failed to set favicon emoji: disk on fire" });
        return;
      }
      current = { ...current, emoji };
    }
    await route.fulfill({ json: { ...current, href: href(current.emoji) } });
  });
  return {
    puts,
    failNextPut() {
      failNext = true;
    },
    hold() {
      let release!: () => void;
      gate = new Promise((r) => (release = r));
      return release;
    },
  };
}

async function openPicker(page: Page, { search = true } = {}) {
  await page.keyboard.press("ControlOrMeta+k");
  await page.locator(".command-palette-input").fill("favicon emoji");
  await page.locator(".command-palette-item").first().click();
  await expect(popover(page)).toBeVisible();
  // Typing searches straight away once the picker has loaded.
  if (search) await expect(popover(page).locator("input[type=search]")).toBeFocused();
}

const popover = (page: Page) => page.getByRole("dialog", { name: "Favicon emoji" });
const favicon = (page: Page) => page.locator('link[rel="icon"]');

test.beforeEach(async ({ page }) => {
  await page.goto("/new");
  await expect(page.getByTestId("message-input")).toBeVisible();
});

test("searching for an emoji and clicking it sets Shelley's favicon", async ({ page }) => {
  const { puts } = await fakeServer(page, { emoji: "🐙", source: "shelley" });
  await openPicker(page);
  await expect(favicon(page)).toHaveAttribute("href", href("🐙"));

  await page.keyboard.type("fox");
  await popover(page).getByRole("option", { name: /fox/ }).click();
  await expect(popover(page)).toBeHidden();
  await expect(favicon(page)).toHaveAttribute("href", href("🦊"));
  expect(puts).toEqual(["🦊"]);
});

test("a failed save keeps the picker open with the error", async ({ page }) => {
  const server = await fakeServer(page, { emoji: "🐙", source: "shelley" });
  server.failNextPut();
  await openPicker(page);
  await page.keyboard.type("cactus");
  await popover(page)
    .getByRole("option", { name: /cactus/ })
    .click();
  await expect(popover(page).getByRole("alert")).toHaveText(/disk on fire/);
  await expect(favicon(page)).toHaveAttribute("href", href("🐙"));

  await popover(page)
    .getByRole("option", { name: /cactus/ })
    .click();
  await expect(popover(page)).toBeHidden();
  await expect(favicon(page)).toHaveAttribute("href", href("🌵"));

  await openPicker(page);
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
});

test("an exe.dev emoji links to where to change it", async ({ page }) => {
  await page.addInitScript(() => {
    let init: Record<string, unknown> | undefined;
    Object.defineProperty(window, "__SHELLEY_INIT__", {
      configurable: true,
      get: () => init,
      set: (v) => (init = { ...v, hostname: "myvm.exe.xyz" }),
    });
  });
  await page.goto("/new");
  const { puts } = await fakeServer(page, { emoji: "🧪", source: "exe.dev" });
  await openPicker(page, { search: false });
  await expect(favicon(page)).toHaveAttribute("href", href("🧪"));
  await expect(popover(page).getByRole("link", { name: "Change it on exe.dev" })).toHaveAttribute(
    "href",
    "https://exe.dev/vm/myvm",
  );
  await expect(popover(page).locator("emoji-picker")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();
  expect(puts).toEqual([]);
});

test("reopening mid-save shows the saved emoji", async ({ page }) => {
  const server = await fakeServer(page, { emoji: "🐙", source: "shelley" });
  await openPicker(page);
  const release = server.hold();
  await page.keyboard.type("cactus");
  await popover(page)
    .getByRole("option", { name: /cactus/ })
    .click();
  await expect(popover(page).getByText("Saving…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover(page)).toBeHidden();

  // The save is still running, and the picker waits for it.
  await openPicker(page, { search: false });
  await expect(popover(page).getByText("Saving…")).toBeVisible();
  await expect(popover(page).locator("emoji-picker")).toHaveCount(0);
  // Keys typed meanwhile stay out of the message input behind the picker.
  await page.keyboard.type("x");
  await expect(page.getByTestId("message-input")).toHaveValue("");
  release();
  await expect(popover(page).locator("input[type=search]")).toBeFocused();
  await expect(favicon(page)).toHaveAttribute("href", href("🌵"));
  expect(server.puts).toEqual(["🌵"]);
});
