import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  openWorkspaceTool,
  createConversationViaAPI,
  git,
  initGitRepo,
  withTempDir,
} from "./helpers";

test.describe("Git graph diffstat links", () => {
  test("opens the selected changed file in the diff viewer", async ({ page, request }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const cwdResp = await request.get("/api/git/diffs?cwd=.");
    expect(cwdResp.ok()).toBeTruthy();
    const { gitRoot } = await cwdResp.json();
    const slug = await createConversationViaAPI(request, "Hello", { cwd: gitRoot });

    await page.goto(`/c/${slug}`);
    await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30000 });
    await openWorkspaceTool(page, "Git Graph");

    const graph = page.locator(".git-graph-container");
    await expect(graph).toBeVisible({ timeout: 30000 });
    const fileLink = graph.locator(".git-graph-diffstat-link").first();
    await expect(fileLink).toBeVisible({ timeout: 30000 });
    const filePath = await fileLink.getAttribute("title");
    expect(filePath).toBeTruthy();
    await expect(fileLink).toHaveAttribute(
      "href",
      new RegExp(`[?&]file=${encodeURIComponent(filePath!)}`),
    );

    await fileLink.click();

    const overlay = page.locator(".diff-viewer-overlay");
    await expect(overlay.locator("select.diff-viewer-select").first()).toHaveValue(filePath!, {
      timeout: 30000,
    });
  });

  test("keeps long paths distinct, counts aligned, and full-path links intact", async ({
    page,
    request,
  }) => {
    await withTempDir("shelley-readable-files-", async (repo) => {
      initGitRepo(repo);
      const github = "server/integrations/github/webhooks/notifications/dispatcher.go";
      const slack = "server/integrations/slack/webhooks/notifications/dispatcher.go";
      const longName = `${"a_very_long_filename_".repeat(6)}test.go`;
      const files = ["db/db.go", github, slack, `server/${longName}`, "assets/logo.bin"];
      for (const file of files) {
        mkdirSync(dirname(join(repo, file)), { recursive: true });
        writeFileSync(join(repo, file), file.endsWith(".bin") ? Buffer.from([0, 1]) : "before\n");
      }
      git(repo, "add", ".");
      git(repo, "commit", "-m", "Base files");
      for (const file of files) {
        writeFileSync(join(repo, file), file.endsWith(".bin") ? Buffer.from([0, 2]) : "after\n");
      }
      git(repo, "add", ".");
      git(repo, "commit", "-m", "Update long paths");

      await page.setViewportSize({ width: 1280, height: 900 });
      const slug = await createConversationViaAPI(request, "Hello", { cwd: repo });
      await page.goto(`/c/${slug}`);
      await expect(page.getByTestId("message-input")).toBeVisible();
      await openWorkspaceTool(page, "Git Graph");
      const graph = page.locator(".git-graph-container");
      const links = graph.locator(".git-graph-diffstat-link");
      await expect(links).toHaveCount(files.length);
      await expect(graph.locator(".git-graph-diffstat-bar")).toHaveCount(0);
      await expect(graph.locator(".git-graph-diffstat-binary")).toHaveText("bin");

      const link = (path: string) => graph.locator(`a[title="${path}"]`);
      const githubLink = link(github);
      const slackLink = link(slack);
      await expect(githubLink.locator(".git-graph-diffstat-path")).toHaveText(
        "server/…/github/…/dispatcher.go",
      );
      await expect(slackLink.locator(".git-graph-diffstat-path")).toHaveText(
        "server/…/slack/…/dispatcher.go",
      );
      await expect(link("db/db.go")).toContainText("db/db.go");
      await expect(link(`server/${longName}`)).toContainText(longName);
      await expect(githubLink).toHaveAccessibleName(`${github}, 1 added, 1 removed`);
      await expect(link("assets/logo.bin")).toHaveAccessibleName("assets/logo.bin, binary");
      await expect(githubLink).toHaveAttribute("title", github);
      await expect(githubLink).toHaveAttribute(
        "href",
        new RegExp(`[?&]file=${encodeURIComponent(github)}`),
      );

      const counts = await links
        .locator(".git-graph-diffstat-counts")
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().right),
        );
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThan(1);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() =>
            links.evaluateAll((elements) =>
              elements.every((element) => element.scrollWidth <= element.clientWidth + 1),
            ),
          )
          .toBe(true);
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await graph.locator(".git-graph-detail").evaluate((element) => {
        (element as HTMLElement).style.width = "900px";
      });
      await expect(githubLink.locator(".git-graph-diffstat-path")).toHaveText(github);
      await githubLink.click();
      await expect(
        page.locator(".diff-viewer-overlay select.diff-viewer-select").first(),
      ).toHaveValue(github);
    });
  });
});
