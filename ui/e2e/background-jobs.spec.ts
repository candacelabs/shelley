import { test, expect } from "@playwright/test";
import { createConversationViaAPIWithDetails } from "./helpers";

test("running work exposes long commands and output in one expansion and stops the command", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { slug, conversationId } = await createConversationViaAPIWithDetails(
    request,
    "bash-bg: echo ready; sleep 600",
  );
  const displayCommand =
    `python3 /tmp/${"long-command-".repeat(20)}.py <<'PY'\n` +
    "print('a multiline command stays readable when expanded')\nPY";
  await page.route(`**/api/conversation/${conversationId}/background-jobs`, async (route) => {
    const response = await route.fetch();
    const jobs = await response.json();
    await route.fulfill({
      response,
      json: jobs.map((job: Record<string, unknown>) => ({ ...job, command: displayCommand })),
    });
  });
  await page.goto(`/c/${slug}`);
  await expect(page.getByTestId("message-input")).toBeVisible({ timeout: 30000 });

  const running = page.getByTestId("bash-tool-running-indicator");
  await expect(running).toBeVisible({ timeout: 15000 });
  const jobsResponse = await request.get(`/api/conversation/${conversationId}/background-jobs`);
  expect(jobsResponse.ok()).toBeTruthy();
  const [{ job_id: jobId }] = await jobsResponse.json();

  const strip = page.getByLabel("Running work", { exact: true });
  const toggle = strip.getByTestId("running-work-toggle");
  await expect(toggle).toContainText("python3", {
    timeout: 15000,
  });
  await expect(toggle.locator(".running-work-activity")).toHaveText("ready");
  await expect(toggle).not.toContainText("print(");
  await expect(toggle.locator(".running-work-name")).toHaveCSS("text-overflow", "ellipsis");
  expect(
    await toggle.locator(".running-work-name").evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(true);
  const preview = await toggle.locator(".running-work-name").evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    limit: parseFloat(getComputedStyle(el).maxWidth),
  }));
  expect(Number.isFinite(preview.limit)).toBe(true);
  expect(preview.width).toBeLessThanOrEqual(preview.limit + 1);
  await page.setViewportSize({ width: 390, height: 500 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await toggle.click();
  const job = strip.getByTestId("background-job");
  await expect(job).toHaveCount(1);
  await expect(job.getByTestId("background-job-command")).toHaveText(displayCommand);
  await expect(toggle).not.toContainText("python3");
  await expect(job.locator("details, summary")).toHaveCount(0);
  await expect(job.getByTestId("background-job-tail")).toContainText("ready");
  await expect(job).not.toContainText("PGID");
  await expect(job).not.toContainText(".log");

  await job.getByTestId("background-job-kill").click();
  await expect(running).toBeHidden({ timeout: 15000 });
  await expect(strip.getByTestId("running-work-toggle")).toContainText("No running work", {
    timeout: 15000,
  });
  await expect(strip.getByTestId("running-work-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(job).toHaveCount(1);
  await expect(job.locator(".running-command-time")).toHaveText("Finished");
  await expect(job.getByTestId("background-job-kill")).toHaveCount(0);
  await expect(job.getByTestId("background-job-tail")).toContainText("ready");
  await strip.getByTestId("running-work-toggle").click();
  await expect(strip).toHaveCount(0, { timeout: 15000 });
  const notice = page.getByTestId("bash-tool-finished-job");
  await expect(notice).toBeVisible({ timeout: 15000 });
  await expect(notice).toHaveText("Failed");
  const card = page.locator(".bash-tool", { has: notice });
  await expect(card).toContainText("echo ready; sleep 600");
  await expect(card.getByRole("button", { name: "Expand" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(card.locator(".bash-tool-details")).toHaveCount(0);
  await card.getByRole("button", { name: "Expand" }).click();
  await expect(card.locator(".bash-tool-code").first()).toHaveText("echo ready; sleep 600");
  await expect(card.locator(".bash-tool-label").last()).toHaveText("Output:");
  await expect(card).not.toContainText(jobId);
});

test("historical background job notices render collapsed bash cards", async ({ page, request }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  const { conversationId, slug } = await createConversationViaAPIWithDetails(
    request,
    "echo: ready",
  );
  const response = await request.get(`/api/conversation/${conversationId}`);
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  body.conversation.agent_working = false;
  const notices = [
    {
      jobId: "abc12345",
      text:
        "Background job abc12345 finished: exit 0, 4m31s. Log: /tmp/shelley-jobs/abc12345.log\n" +
        "Command: bin/q --only 59e4fc203f\n\nq: checking\n\nq: passed",
    },
    {
      jobId: "def67890",
      text: "Older, unrecognized job notice\nits output must still be readable",
    },
    {
      jobId: "1234abcd",
      text:
        "Background job 1234abcd lost (host rebooted or killed). Log: /tmp/shelley-jobs/1234abcd.log\n" +
        "Command: cat /tmp/partial\n\none\ntwo",
    },
  ];
  body.messages = notices.map(({ jobId, text }, index) => ({
    message_id: `job-${jobId}`,
    conversation_id: conversationId,
    sequence_id: index + 1,
    type: "user",
    llm_data: JSON.stringify({ Role: 0, Content: [{ Type: 2, Text: text }] }),
    user_data: JSON.stringify({ background_job_id: jobId, Text: text }),
    created_at: "2026-09-22T12:00:00Z",
    generation: 1,
  }));
  body.conversation.queued_messages = JSON.stringify([
    {
      id: "queued-job",
      created_at: "2026-09-22T12:00:01Z",
      model: "predictable",
      llm: { Role: 0, Content: [{ Type: 2, Text: "queued job output" }] },
      user_data: {
        background_job_id: "fedcba98",
        command: "sleep 100 && echo foo",
        exit_code: 0,
        duration: "1m40s",
        log_path: "/tmp/shelley-jobs/fedcba98.log",
        tail: "foo",
      },
    },
  ]);
  await page.route("**/api/stream2*", (route) => route.abort());
  await page.route("**/api/conversations/snapshot", async (route) => {
    const snapshotResponse = await route.fetch();
    const snapshot = await snapshotResponse.json();
    const conversation = snapshot.conversations.find(
      (c: { conversation_id: string }) => c.conversation_id === conversationId,
    );
    expect(conversation).toBeTruthy();
    conversation.queued_messages = body.conversation.queued_messages;
    await route.fulfill({ response: snapshotResponse, json: snapshot });
  });
  await page.route(`**/api/conversation/${conversationId}*`, (route) =>
    route.fulfill({ response, json: body }),
  );
  await page.goto(`/c/${slug}`);

  const parsed = page.getByTestId("message").filter({ hasText: "bin/q --only 59e4fc203f" });
  await expect(parsed).toHaveClass(/message-tool-card/);
  await expect(parsed.getByTestId("message-author-background-job")).toHaveCount(0);
  const card = parsed.locator(".bash-tool");
  await expect(card.getByTestId("bash-tool-finished-job")).toHaveText("Finished");
  const positions = await card.locator(".bash-tool-summary").evaluate((summary) => {
    const top = (selector: string) => summary.querySelector(selector)!.getBoundingClientRect().top;
    return {
      emoji: top(".bash-tool-emoji"),
      command: top(".bash-tool-command"),
      status: top('[data-testid="bash-tool-finished-job"]'),
    };
  });
  expect(Math.abs(positions.emoji - positions.command)).toBeLessThan(2);
  expect(positions.status).toBeGreaterThan(positions.command);
  await expect(card.locator(".bash-tool-details")).toHaveCount(0);
  await card.getByRole("button", { name: "Expand" }).click();
  await expect(card.locator(".bash-tool-code").last()).toHaveText("q: checking\n\nq: passed");
  await expect(card.locator(".bash-tool-code").last()).toHaveCSS("font-family", /mono/i);
  await expect(card).not.toContainText("abc12345");
  await expect(card.locator(".bash-tool-label").last()).toHaveText("Output:");

  const unknown = page.locator('[data-message-id="job-def67890"]');
  await expect(unknown).toHaveClass(/message-tool-card/);
  const unknownCard = unknown.locator(".bash-tool");
  await expect(unknownCard.getByTestId("bash-tool-finished-job")).toHaveText("Background update");
  await expect(unknownCard.locator(".bash-tool-details")).toHaveCount(0);
  await unknownCard.getByRole("button", { name: "Expand" }).click();
  await expect(unknownCard.locator(".bash-tool-section")).toHaveCount(1);
  await expect(unknownCard.locator(".bash-tool-label")).toHaveText("Output:");
  await expect(unknownCard.locator(".bash-tool-code").last()).toHaveText(notices[1].text);

  const lost = page.locator('[data-message-id="job-1234abcd"] .bash-tool');
  await expect(lost.getByTestId("bash-tool-finished-job")).toHaveText("Lost");
  await lost.getByRole("button", { name: "Expand" }).click();
  await expect(lost.locator(".bash-tool-label").last()).toHaveText("Output:");
  await expect(lost.locator(".bash-tool-code").last()).toHaveClass(/error/);
  await expect(lost.locator(".bash-tool-code").last()).toHaveText("one\ntwo");

  const queued = page.getByTestId("queued-ghost");
  await expect(queued).toHaveClass(/message-tool-card/);
  await expect(queued.getByTestId("queued-badge")).toBeVisible();
  await expect(queued.getByTestId("bash-tool-finished-job")).toHaveText("Finished");
  await expect(queued.locator(".bash-tool-details")).toHaveCount(0);
  await queued.getByRole("button", { name: "Expand" }).click();
  await expect(queued.locator(".bash-tool-code").last()).toHaveText("foo");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  const widths = await queued.evaluate((element) => [
    element.getBoundingClientRect().width,
    element.querySelector(".message-content")!.getBoundingClientRect().width,
  ]);
  expect(Math.abs(widths[0] - widths[1])).toBeLessThan(2);

  await page.reload();
  await expect(parsed.locator(".bash-tool-details")).toHaveCount(0);
  await expect(parsed.getByTestId("bash-tool-finished-job")).toHaveText("Finished");
});
