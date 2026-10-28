import { expect, test } from "@playwright/test";
import { createConversationViaAPI, openWorkspaceTool } from "./helpers";

test("path labels keep the home prefix, highlights, tail and full-path hover", async ({
  page,
  request,
}) => {
  const home = "/home/adam";
  const path = `${home}/projects/shelley/ui/src/vue/components/MessageInput.vue`;
  const unicodePath = "/var/work trees/shelley (review)/التقارير/דוח-final.v2.json";
  await page.route("**/api/git/repos", (route) =>
    route.fulfill({
      json: {
        repos: [{ path, branch: "main" }, { path: unicodePath }],
        roots: [home],
        truncated: false,
      },
    }),
  );

  const slug = await createConversationViaAPI(request, "Hello");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/c/${slug}`);
  await openWorkspaceTool(page, "Git Graph");
  await page.getByRole("button", { name: "Pick repository", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Pick git repository", exact: true });
  const label = picker.locator(".grp-path").filter({ hasText: "MessageInput.vue" });
  await expect(label).toBeVisible();
  await expect(label).toHaveAttribute("title", path);
  expect(await label.textContent()).toBe("~" + path.slice(home.length));

  const prefix = label.locator(".path-text-prefix");
  const tail = label.locator(".path-text-tail");
  await expect(prefix).toHaveText("~/");
  await expect(tail).toHaveCSS("direction", "rtl");
  await expect(tail).toHaveCSS("text-align", "left");
  expect(await tail.evaluate((el) => getComputedStyle(el, "::before").content)).toBe('"\u200e"');

  await picker.getByRole("textbox", { name: "Filter", exact: true }).fill("messageinput");
  await expect(label.locator("mark")).toHaveText(["MessageInput"]);
  await expect(label.locator("mark[title]")).toHaveCount(0);
  expect(await label.textContent()).toBe("~" + path.slice(home.length));

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(prefix).toBeVisible();
    await expect(label).toHaveAttribute("title", path);
    const geometry = await label.evaluate((el) => {
      const prefix = el.querySelector(".path-text-prefix")!.getBoundingClientRect();
      const tail = el.querySelector(".path-text-tail")!;
      const clip = tail.getBoundingClientRect();
      const walker = document.createTreeWalker(tail, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node as Text).length) last = node as Text;
      }
      const range = document.createRange();
      range.setStart(last!, last!.length - 4);
      range.setEnd(last!, last!.length);
      const extension = range.getBoundingClientRect();
      const row = el.closest(".grp-row")!;
      return {
        overflow: tail.scrollWidth > tail.clientWidth,
        prefixWidth: prefix.width,
        prefixBeforeTail: prefix.right <= clip.left + 1,
        extensionVisible: extension.left >= clip.left - 1 && extension.right <= clip.right + 1,
        iconBeforePath:
          row.querySelector(".grp-icon")!.getBoundingClientRect().right <= prefix.left,
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.prefixWidth).toBeGreaterThan(0);
    expect(geometry.prefixBeforeTail).toBe(true);
    expect(geometry.extensionVisible).toBe(true);
    expect(geometry.iconBeforePath).toBe(true);
    expect(geometry.pageOverflow).toBe(false);
    if (width === 320) expect(geometry.overflow).toBe(true);
  }

  await picker.getByRole("textbox", { name: "Filter", exact: true }).fill("");
  const unicode = picker.locator(".grp-path").filter({ hasText: "דוח-final.v2.json" });
  await expect(unicode).toHaveAttribute("title", unicodePath);
  expect(await unicode.textContent()).toBe(unicodePath);
  await expect(unicode.locator(".path-text-prefix")).toHaveCount(0);
});
