import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createConversationViaAPIWithDetails, git, initGitRepo, withTempDir } from "./helpers";

const shelleyBin = resolve(fileURLToPath(new URL("../../bin/shelley", import.meta.url)));

test("git info shows and opens an attached commit tour", async ({ page, request }) => {
  await withTempDir("shelley-gitinfo-tour-", async (tempDir) => {
    const repo = join(tempDir, "repo");
    mkdirSync(repo);
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Base commit");
    git(repo, "branch", "upstream");
    git(repo, "switch", "-c", "feature");
    git(repo, "branch", "--set-upstream-to=upstream", "feature");

    const { slug } = await createConversationViaAPIWithDetails(
      request,
      "bash: printf 'after\\n' > example.txt && git add example.txt && git commit -m 'Tour this commit'",
      { cwd: repo },
    );
    const hash = git(repo, "rev-parse", "HEAD");
    const shortHash = hash.slice(0, 7);

    const scaffold = JSON.parse(
      execFileSync(shelleyBin, ["tour", "scaffold", "-C", repo, hash], { encoding: "utf8" }),
    );
    const tourPath = join(tempDir, "tour.json");
    writeFileSync(
      tourPath,
      JSON.stringify({
        ...scaffold,
        title: "Tour this commit",
        intro: "Follow the commit directly from its chat status line.",
        chunks: scaffold.chunks.map((chunk: { ref: number }) => ({
          ...chunk,
          comment: "The guided change.",
        })),
      }),
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    const missingProbe = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/git/tour/status?") &&
        response.status() === 200,
    );
    await page.goto(`/c/${slug}`);
    await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30_000 });
    await missingProbe;

    const gitInfo = page.getByTestId("message-gitinfo").filter({ hasText: shortHash });
    const tourLink = gitInfo.getByRole("link", { name: "Open Tour", exact: true });
    await expect(tourLink).toHaveCount(0);
    await expect(gitInfo.getByTestId("gitinfo-tour-request")).toBeVisible();

    execFileSync(shelleyBin, ["tour", "attach", "-C", repo, hash, tourPath]);
    git(repo, "reset", "--hard", "upstream");
    await gitInfo.hover();
    await expect(tourLink).toBeVisible();
    await expect(tourLink).toHaveAttribute("href", /[?&]diff=/);

    await tourLink.click();
    const overlay = page.locator(".diff-viewer-overlay");
    await expect(overlay).toBeVisible({ timeout: 30_000 });
    await expect(overlay.locator(".diff-viewer-view-switcher button.active")).toHaveText("Tour");
    await expect(overlay.locator(".commit-tour-introduction h1")).toHaveText("Tour this commit");

    // Open Diff on the same commit stays on Files.
    await overlay.locator(".diff-viewer-close:visible").first().click();
    await expect(overlay).toHaveCount(0);
    const diffLink = gitInfo.getByRole("link", { name: "Open Diff", exact: true });
    await expect(diffLink).toHaveAttribute("href", /[?&]view=files/);
    await diffLink.click();
    await expect(overlay.locator(".diff-viewer-view-switcher button.active")).toHaveText("Files", {
      timeout: 30_000,
    });
  });
});

test("missing tour requests a visible background subagent", async ({ page, request }) => {
  await withTempDir("shelley-gitinfo-tour-request-", async (tempDir) => {
    const repo = join(tempDir, "repo");
    mkdirSync(repo);
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Base commit");
    git(repo, "branch", "upstream");
    git(repo, "switch", "-c", "feature");
    git(repo, "branch", "--set-upstream-to=upstream", "feature");

    const { conversationId, slug } = await createConversationViaAPIWithDetails(
      request,
      "bash: printf 'after\\n' > example.txt && git add example.txt && git commit -m 'Request this tour'",
      { cwd: repo },
    );
    const hash = git(repo, "rev-parse", "HEAD");
    const shortHash = hash.slice(0, 7);
    let state: "absent" | "building" | "present" = "absent";
    let requestedMessage = "";

    await page.route("**/api/git/tour/status?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: state,
          hash,
          worker_conversation_id: state === "building" ? "tour-worker" : undefined,
          worker_slug: state === "building" ? "tour-worker-slug" : undefined,
        }),
      });
    });
    await page.route(`**/api/conversation/${conversationId}/chat`, async (route) => {
      const body = route.request().postDataJSON() as { message?: string };
      if (!body.message?.startsWith("/tour ")) {
        await route.continue();
        return;
      }
      requestedMessage = body.message;
      state = "building";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          status: "accepted",
          tour: {
            status: "building",
            hash,
            worker_conversation_id: "tour-worker",
            worker_slug: "tour-worker-slug",
          },
        }),
      });
    });

    await page.goto(`/c/${slug}`);
    await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30_000 });
    const gitInfo = page.getByTestId("message-gitinfo").filter({ hasText: shortHash });
    await gitInfo.getByTestId("gitinfo-tour-request").click();

    const building = gitInfo.getByTestId("gitinfo-tour-building");
    await expect(building).toContainText("Building tour");
    await expect(building).toHaveAttribute("href", /[?&]diff=/);
    expect(requestedMessage).toBe(`/tour ${shortHash}\n${repo}`);

    state = "present";
    await expect(gitInfo.getByTestId("gitinfo-tour-link")).toBeVisible({ timeout: 10_000 });
  });
});

test("git info keeps the approved compact layout in both themes", async ({ page, request }) => {
  await withTempDir("shelley-gitinfo-layout-", async (tempDir) => {
    const repo = join(tempDir, "projects", "long-parent-context", "worktrees", "active-checkout");
    const branch = "feature/keep-long-conversation-metadata-readable";
    const subject =
      "Keep full commit subjects and branch names readable in the compact conversation git strip";
    mkdirSync(repo, { recursive: true });
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "Base commit");
    git(repo, "switch", "-c", branch);
    const { slug } = await createConversationViaAPIWithDetails(
      request,
      `bash: printf 'after\\n' > example.txt && git add example.txt && git commit -m '${subject}'`,
      { cwd: repo },
    );
    const shortHash = git(repo, "rev-parse", "--short", "HEAD");
    await page.route("**/api/git/tour/status?*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ status: "absent", hash: shortHash }),
      }),
    );
    await page.goto(`/c/${slug}`);
    const strip = page.getByTestId("message-gitinfo").filter({ hasText: shortHash });
    const diff = strip.getByRole("link", { name: "Open Diff", exact: true });
    const buildTour = strip.getByRole("button", { name: "Build tour", exact: true });
    await expect(buildTour).toBeVisible();
    await expect(strip.locator(".msg-subject")).toHaveText(subject);
    await expect(strip.locator(".msg-subject")).toHaveAttribute("title", subject);
    await expect(strip.locator(".msg-branch")).toHaveText(branch);
    await expect(strip.locator(".msg-worktree")).toHaveAttribute("title", repo);
    await expect(diff).toHaveAttribute("href", new RegExp(`cwd=${encodeURIComponent(repo)}`));

    for (const dark of [false, true]) {
      await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark);
      await expect(strip).toHaveCSS("background-color", dark ? "rgb(31, 41, 55)" : "rgb(243, 244, 246)");
      for (const width of [1280, 960, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(async () => {
          const layout = await strip.evaluate((element) => {
            const rect = (selector: string) =>
              element.querySelector(selector)!.getBoundingClientRect().toJSON();
            return {
              title: rect(".msg-subject"),
              branch: rect(".msg-branch"),
              hash: rect(".msg-commit-hash"),
              path: rect(".msg-worktree"),
              diff: rect(".msg-diff-link"),
              tour: rect(".msg-tour-action"),
              fonts: [...element.querySelectorAll(
                ".msg-subject, .msg-branch, .msg-commit-hash, .msg-worktree",
              )].map((child) => getComputedStyle(child).fontSize),
              actionFonts: [...element.querySelectorAll(".msg-diff-link, .msg-tour-action")]
                .map((child) => getComputedStyle(child).fontSize),
              pathLabel: element.querySelector(".msg-worktree")!.textContent!.trim(),
              overflow: document.documentElement.scrollWidth > window.innerWidth,
              branchOverflow: element.querySelector(".msg-branch")!.scrollWidth >
                element.querySelector(".msg-branch")!.clientWidth + 1,
            };
          });
          expect(layout.fonts.every((font) => font === "14px")).toBe(true);
          expect(layout.actionFonts.every((font) => font === "12px")).toBe(true);
          expect(layout.overflow).toBe(false);
          expect(Math.abs(layout.title.x - layout.branch.x)).toBeLessThan(1);
          expect(layout.diff.y).toBe(layout.tour.y);
          expect(layout.diff.height).toBe(22);
          expect(layout.tour.height).toBe(22);
          expect(layout.pathLabel.endsWith("active-checkout")).toBe(true);
          if (width > 640) {
            expect(layout.title.height).toBe(20);
            expect(layout.diff.y - layout.title.bottom).toBe(7);
            expect(Math.abs(layout.branch.y + layout.branch.height / 2 -
              layout.diff.y - layout.diff.height / 2)).toBeLessThan(1);
          } else {
            expect(layout.branchOverflow).toBe(false);
            expect(layout.diff.y).toBeGreaterThanOrEqual(
              Math.max(layout.branch.bottom, layout.hash.bottom, layout.path.bottom),
            );
          }
        }).toPass();
      }
    }
    await diff.click();
    await expect(page.locator(".diff-viewer-overlay")).toBeVisible();
  });
});

test("git info aligns detached HEAD metadata with the subject", async ({ page, request }) => {
  await withTempDir("shelley-gitinfo-detached-", async (repo) => {
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "Base commit");
    git(repo, "checkout", "--detach");
    const { slug } = await createConversationViaAPIWithDetails(
      request,
      "bash: printf 'after\\n' > example.txt && git add example.txt && git commit -m 'Detached HEAD change'",
      { cwd: repo },
    );
    await page.goto(`/c/${slug}`);
    const strip = page.getByTestId("message-gitinfo").filter({
      hasText: git(repo, "rev-parse", "--short", "HEAD"),
    });
    await expect(strip.locator(".msg-subject")).toBeVisible();
    await expect(strip.locator(".msg-branch")).toHaveCount(0);
    for (const width of [1280, 960, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(async () => {
        const offsets = await strip.evaluate((element) => ({
          title: element.querySelector(".msg-subject")!.getBoundingClientRect().x,
          hash: element.querySelector(".msg-commit-hash")!.getBoundingClientRect().x,
        }));
        expect(Math.abs(offsets.title - offsets.hash)).toBeLessThan(1);
      }).toPass();
    }
  });
});

test("/tour shows a compact event that offers the tour when ready", async ({ page, request }) => {
  await withTempDir("shelley-tour-auto-open-", async (tempDir) => {
    const repo = join(tempDir, "repo");
    mkdirSync(repo);
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Marker commit");
    const hash = git(repo, "rev-parse", "HEAD");
    const { slug } = await createConversationViaAPIWithDetails(request, "Hello", { cwd: repo });

    let state: "building" | "present" = "building";
    await page.route("**/api/git/tour/status?*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: state,
          hash,
          worker_slug: state === "building" ? "tour-worker" : undefined,
        }),
      });
    });
    await page.goto(`/c/${slug}`);
    await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
      const textarea = document.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "/tour");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Send message" }).click();
    const event = page.getByTestId("message-tour-request");
    await expect(event).toHaveClass(/message-gitinfo/);
    await expect(event).not.toHaveClass(/message-agent/);
    await expect(event.getByTestId("gitinfo-tour-building")).toHaveAttribute("href", /[?&]diff=/);
    await expect(event.locator(".spinner")).toBeVisible();

    const scaffold = JSON.parse(
      execFileSync(shelleyBin, ["tour", "scaffold", "-C", repo, hash], { encoding: "utf8" }),
    );
    const tourPath = join(tempDir, "tour.json");
    writeFileSync(
      tourPath,
      JSON.stringify({
        ...scaffold,
        title: "Auto-open tour",
        chunks: scaffold.chunks.map((chunk: { ref: number }) => ({
          ...chunk,
          comment: "The guided change.",
        })),
      }),
    );
    execFileSync(shelleyBin, ["tour", "attach", "-C", repo, hash, tourPath]);
    state = "present";
    const open = event.getByTestId("gitinfo-tour-link");
    await expect(open).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".commit-tour-introduction")).toHaveCount(0);
    await open.click();
    await expect(page.locator(".commit-tour-introduction h1")).toHaveText("Auto-open tour", {
      timeout: 15_000,
    });
  });
});

test("bare and explicit /tour open an attached HEAD tour", async ({ page, request }) => {
  await withTempDir("shelley-bare-tour-", async (tempDir) => {
    const repo = join(tempDir, "repo");
    mkdirSync(repo);
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "the change\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Tour HEAD");
    const hash = git(repo, "rev-parse", "HEAD");
    const scaffold = JSON.parse(
      execFileSync(shelleyBin, ["tour", "scaffold", "-C", repo, hash], { encoding: "utf8" }),
    );
    const tourPath = join(tempDir, "tour.json");
    writeFileSync(
      tourPath,
      JSON.stringify({
        ...scaffold,
        title: "HEAD tour",
        intro: "The HEAD commit adds the change.",
        chunks: scaffold.chunks.map((chunk: { ref: number }) => ({
          ...chunk,
          comment: "The guided change.",
        })),
      }),
    );
    execFileSync(shelleyBin, ["tour", "attach", "-C", repo, hash, tourPath]);

    const { slug } = await createConversationViaAPIWithDetails(request, "Hello", { cwd: repo });
    await page.goto(`/c/${slug}`);
    const input = page.getByTestId("message-input");
    await expect(input).toBeVisible();
    for (const command of ["/tour", `/tour ${hash}`]) {
      await page.evaluate((value) => {
        const textarea = document.querySelector('[data-testid="message-input"]') as HTMLTextAreaElement;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }, command);
      await page.getByRole("button", { name: "Send message" }).click();
      await expect(page.locator(".commit-tour-introduction h1")).toHaveText("HEAD tour");
      await page.locator(".diff-viewer-container .diff-viewer-close:visible").first().click();
      await expect(page.locator(".commit-tour-introduction h1")).toHaveCount(0);
    }
  });
});
