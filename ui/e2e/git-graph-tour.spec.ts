import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openWorkspaceTool,
  createConversationViaAPI,
  createConversationViaAPIWithDetails,
  git,
  initGitRepo,
  withTempDir,
} from "./helpers";

const shelleyBin = resolve(fileURLToPath(new URL("../../bin/shelley", import.meta.url)));

test("git graph shows and opens an attached commit tour", async ({ page, request }) => {
  await withTempDir("shelley-git-graph-tour-", async (tempDir) => {
    const repo = join(tempDir, "repo");
    mkdirSync(repo);
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Base commit");
    writeFileSync(join(repo, "example.txt"), "after\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Tour from graph");
    const hash = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(repo, "tip.txt"), "tip\n");
    git(repo, "add", "tip.txt");
    git(repo, "commit", "-m", "Tip commit");

    const scaffold = JSON.parse(
      execFileSync(shelleyBin, ["tour", "scaffold", "-C", repo, hash], { encoding: "utf8" }),
    );
    const tourPath = join(tempDir, "tour.json");
    writeFileSync(
      tourPath,
      JSON.stringify({
        ...scaffold,
        title: "Tour from graph",
        intro: "Open this tour directly from the git graph.",
        chunks: scaffold.chunks.map((chunk: { ref: number }) => ({
          ...chunk,
          comment: "The guided change.",
        })),
      }),
    );
    execFileSync(shelleyBin, ["tour", "attach", "-C", repo, hash, tourPath]);

    const slug = await createConversationViaAPI(request, "Hello", { cwd: repo });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/c/${slug}`);
    await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30_000 });
    await openWorkspaceTool(page, "Git Graph");

    const graph = page.locator(".git-graph-container");
    await expect(graph).toBeVisible({ timeout: 30_000 });
    const tourRow = graph.locator(".git-graph-row", { hasText: "Tour from graph" });
    const baseRow = graph.locator(".git-graph-row", { hasText: "Base commit" });
    const tipRow = graph.locator(".git-graph-row", { hasText: "Tip commit" });
    const tourLink = tourRow.getByTestId("git-graph-tour-link");
    await expect(tourLink).toHaveText("tour");
    await expect(tourLink).toHaveAttribute("href", new RegExp(`[?&]diff=${hash}`));
    await expect(baseRow.getByTestId("git-graph-tour-link")).toHaveCount(0);
    await expect(tipRow.getByTestId("git-graph-tour-link")).toHaveCount(0);
    await expect(graph.locator(".git-graph-row", { hasText: "Notes added by" })).toHaveCount(0);
    await expect(graph.getByRole("link", { name: "Open diff" })).toBeVisible();

    await graph.getByRole("button", { name: "Current branch" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(tourRow).toHaveClass(/git-graph-row-selected/);
    await expect(graph.getByRole("link", { name: "Open tour" })).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await expect(tipRow).toHaveClass(/git-graph-row-selected/);

    await page.setViewportSize({ width: 390, height: 844 });
    await graph.getByRole("button", { name: "Close commit details" }).click();
    await expect(graph.locator(".git-graph-detail-sheet-open")).toHaveCount(0);
    await tourLink.focus();
    await page.keyboard.press("Enter");
    const overlay = page.locator(".diff-viewer-overlay").last();
    await expect(overlay.locator(".diff-viewer-view-switcher button.active")).toHaveText("Tour", {
      timeout: 30_000,
    });
    await expect(overlay.locator(".commit-tour-introduction h1")).toHaveText("Tour from graph");
    await page.keyboard.press("ArrowDown");
    await expect(overlay.locator(".commit-tour-introduction h1")).toHaveText("Tour from graph");

    await overlay.getByRole("button", { name: "Close (Esc)" }).click();
    await expect(tourRow).toHaveClass(/git-graph-row-selected/);
    await expect(graph.locator(".git-graph-detail-sheet-open")).toHaveCount(0);
  });
});

test("git graph's building button opens the tour pane", async ({ page, request }) => {
  await withTempDir("shelley-git-graph-build-tour-", async (tempDir) => {
    const repo = join(tempDir, "repo");
    mkdirSync(repo);
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Base commit");
    writeFileSync(join(repo, "example.txt"), "after\n");
    git(repo, "commit", "-am", "Build a graph tour");
    const hash = git(repo, "rev-parse", "HEAD");

    const { conversationId, slug } = await createConversationViaAPIWithDetails(request, "Hello", {
      cwd: repo,
    });
    const { slug: builderSlug } = await createConversationViaAPIWithDetails(request, "Hello", {
      cwd: repo,
    });
    let state: "absent" | "building" | "present" = "absent";
    let failNextStatus = false;
    await page.route("**/api/git/tour/status?*", async (route) => {
      if (failNextStatus) {
        failNextStatus = false;
        await route.fulfill({ status: 503, body: "temporary" });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: state,
          hash,
          worker_slug: state === "building" ? builderSlug : undefined,
        }),
      });
    });
    await page.route(`**/api/conversation/${conversationId}/chat`, async (route) => {
      const body = route.request().postDataJSON() as { message?: string };
      if (!body.message?.startsWith("/tour ")) return route.continue();
      state = "building";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          status: "accepted",
          tour: { status: "building", hash, worker_slug: builderSlug },
        }),
      });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/c/${slug}`);
    await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30_000 });
    await openWorkspaceTool(page, "Git Graph");
    const graph = page.locator(".git-graph-container");
    const actions = graph.locator(".git-graph-detail-actions");
    await expect(actions.getByRole("link", { name: "Open diff" })).toBeVisible();
    await actions.getByRole("button", { name: "Build tour" }).click();
    await expect(actions.getByRole("link", { name: "Open diff" })).toBeVisible();
    const building = actions.getByRole("button", { name: /Building tour/ });
    await expect(building.locator(".spinner")).toBeVisible();
    await expect(actions.getByRole("button", { name: "Build tour" })).toHaveCount(0);
    await building.click();
    const overlay = page.locator(".diff-viewer-overlay");
    await expect(overlay.locator(".diff-viewer-view-switcher button.active")).toHaveText(
      "Building tour",
    );

    const failedProbe = page.waitForResponse(
      (response) => response.url().includes("/api/git/tour/status?") && response.status() === 503,
    );
    failNextStatus = true;
    await failedProbe;
    const scaffold = JSON.parse(
      execFileSync(shelleyBin, ["tour", "scaffold", "-C", repo, hash], { encoding: "utf8" }),
    );
    const tourPath = join(tempDir, "tour.json");
    writeFileSync(
      tourPath,
      JSON.stringify({
        ...scaffold,
        title: "Graph tour",
        chunks: scaffold.chunks.map((chunk: { ref: number }) => ({
          ...chunk,
          comment: "The guided change.",
        })),
      }),
    );
    execFileSync(shelleyBin, ["tour", "attach", "-C", repo, hash, tourPath]);
    state = "present";
    await expect(overlay.locator(".commit-tour-introduction h1")).toHaveText("Graph tour", {
      timeout: 15_000,
    });
  });
});

test("diff viewer builds a tour for the commit on screen", async ({ page, request }) => {
  await withTempDir("shelley-diff-tour-request-", async (tempDir) => {
    const repo = join(tempDir, "repo");
    mkdirSync(repo);
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Base commit");
    writeFileSync(join(repo, "example.txt"), "after\n");
    git(repo, "commit", "-am", "Tour from the diff viewer");
    const hash = git(repo, "rev-parse", "HEAD");

    const { conversationId, slug } = await createConversationViaAPIWithDetails(request, "Hello", {
      cwd: repo,
    });
    const { slug: builderSlug } = await createConversationViaAPIWithDetails(request, "Hello", {
      cwd: repo,
    });
    let state: "absent" | "building" | "present" = "absent";
    await page.route("**/api/git/tour/status?*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: state,
          hash,
          worker_slug: state === "building" ? builderSlug : undefined,
        }),
      }),
    );
    const requests: string[] = [];
    await page.route(`**/api/conversation/${conversationId}/chat`, async (route) => {
      const body = route.request().postDataJSON() as { message?: string };
      if (!body.message?.startsWith("/tour ")) return route.continue();
      requests.push(body.message);
      state = "building";
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          status: "accepted",
          tour: { status: "building", hash, worker_slug: builderSlug },
        }),
      });
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/c/${slug}?diff=${hash}&cwd=${encodeURIComponent(repo)}`);
    const overlay = page.locator(".diff-viewer-overlay");
    const row = overlay.locator(".diff-viewer-view-switcher");
    await row.getByRole("button", { name: "Build tour" }).click({ timeout: 30_000 });
    const building = row.getByRole("button", { name: "Building tour" });
    await expect(building).toHaveClass(/active/);
    await expect(building.locator(".spinner")).toBeVisible();
    expect(requests).toEqual([`/tour ${hash}\n${repo}`]);

    // A range through the working tree has no tour to build.
    const commitPicker = overlay.getByRole("button", { name: "Commit", exact: true });
    const range = overlay.getByRole("dialog", { name: "Choose commit" });
    await commitPicker.click();
    await range.getByRole("radio", { name: "Through working tree" }).click();
    await expect(row).toHaveCount(0);
    await range.getByRole("radio", { name: "Single commit" }).click();
    await page.keyboard.press("Escape");
    await expect(range).toHaveCount(0);
    await expect(building).toBeVisible();

    // Once the subagent attaches it, the tour takes over the viewer.
    const scaffold = JSON.parse(
      execFileSync(shelleyBin, ["tour", "scaffold", "-C", repo, hash], { encoding: "utf8" }),
    );
    const tourPath = join(tempDir, "tour.json");
    writeFileSync(
      tourPath,
      JSON.stringify({
        ...scaffold,
        title: "Requested tour",
        chunks: scaffold.chunks.map((chunk: { ref: number }) => ({
          ...chunk,
          comment: "The guided change.",
        })),
      }),
    );
    execFileSync(shelleyBin, ["tour", "attach", "-C", repo, hash, tourPath]);
    state = "present";
    await expect(row.locator("button.active")).toHaveText("Tour");
    await expect(overlay.locator(".commit-tour-introduction h1")).toHaveText("Requested tour");
  });
});

test("diff viewer opens a building tour on its progress", async ({ page, request }) => {
  await withTempDir("shelley-diff-tour-worker-", async (tempDir) => {
    const repo = join(tempDir, "repo");
    mkdirSync(repo);
    initGitRepo(repo);
    writeFileSync(join(repo, "example.txt"), "before\n");
    git(repo, "add", "example.txt");
    git(repo, "commit", "-m", "Tour already building");
    const hash = git(repo, "rev-parse", "HEAD");

    const { slug } = await createConversationViaAPIWithDetails(request, "Hello", { cwd: repo });
    const { slug: builderSlug } = await createConversationViaAPIWithDetails(request, "Hello", {
      cwd: repo,
    });
    await page.route("**/api/git/tour/status?*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ status: "building", hash, worker_slug: builderSlug }),
      }),
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/c/${slug}?diff=${hash}&cwd=${encodeURIComponent(repo)}`);
    const overlay = page.locator(".diff-viewer-overlay");
    await expect(
      overlay.locator(".diff-viewer-view-switcher").getByRole("button", { name: "Building tour" }),
    ).toHaveClass(/active/, { timeout: 30_000 });
    await expect(overlay.getByTestId("tour-build-progress")).toBeVisible();
  });
});
