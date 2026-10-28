import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConversationViaAPIWithDetails, withTempDir } from "./helpers";

const prefix = "Use the following skills: `draft-review`.\n\n";

// Opens a started conversation whose prompt lists one skill, ready to pick it.
async function openConversation(
  page: Page,
  request: Parameters<typeof createConversationViaAPIWithDetails>[0],
  cwd: string,
) {
  const dir = join(cwd, ".skills", "draft-review");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    "---\nname: draft-review\ndescription: Review a draft for clarity\n---\nRead the draft.\n",
  );
  const created = await createConversationViaAPIWithDetails(request, "echo: fixture", { cwd });
  await page.goto(`/c/${created.slug}`);
  return created.conversationId;
}

async function pickSkill(page: Page) {
  const input = page.getByTestId("message-input");
  await input.fill("/skills draft");
  await page.getByTestId("skill-picker").getByRole("option").first().click();
  await expect(page.getByTestId("skill-chip")).toContainText("draft-review");
  return input;
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("choosing a skill adds a chip, clears /skills and sends nothing", async ({
    page,
    request,
  }) => {
    await withTempDir("shelley-skills-", async (cwd) => {
      await openConversation(page, request, cwd);
      const sent: string[] = [];
      page.on("request", (req) => {
        if (req.method() === "POST") sent.push(req.url());
      });
      const input = await pickSkill(page);
      await expect(input).toHaveValue("");
      await expect(page.getByTestId("skill-picker")).toBeHidden();
      expect(sent).toEqual([]);
    });
  });

  test("the chip can be removed", async ({ page, request }) => {
    await withTempDir("shelley-skills-", async (cwd) => {
      await openConversation(page, request, cwd);
      await pickSkill(page);
      await page.getByRole("button", { name: "Remove skill draft-review" }).click();
      await expect(page.getByTestId("skill-chip")).toHaveCount(0);
    });
  });

  test("sending carries the skill and the stored message has the prefix", async ({
    page,
    request,
  }) => {
    await withTempDir("shelley-skills-", async (cwd) => {
      const id = await openConversation(page, request, cwd);
      const input = await pickSkill(page);
      await input.fill("echo: please review");
      const posted = page.waitForRequest(
        (req) =>
          req.method() === "POST" && new URL(req.url()).pathname === `/api/conversation/${id}/chat`,
      );
      await page.getByTestId("send-button").click();
      expect((await posted).postDataJSON()).toMatchObject({
        message: "echo: please review",
        skills: ["draft-review"],
      });
      await expect(page.getByTestId("skill-chip")).toHaveCount(0);
      await expect(page.getByText("Use the following skills:")).toBeVisible();
      const state = await (await request.get(`/api/conversation/${id}`)).json();
      const stored = state.messages
        .filter((m: { type: string }) => m.type === "user")
        .map((m: { llm_data: string }) => JSON.parse(m.llm_data).Content[0].Text);
      expect(stored.at(-1)).toBe(prefix + "echo: please review");
    });
  });
});

test("mobile skill sheet opens without focusing its search field", async ({ page, request }) => {
  await withTempDir("shelley-skills-", async (cwd) => {
    await openConversation(page, request, cwd);
    await page.getByTestId("message-input").fill("/skills draft-review");
    const picker = page.getByTestId("skill-picker");
    await expect(picker.getByRole("option")).toHaveCount(1);
    await expect(picker.getByRole("searchbox", { name: "Find a skill" })).not.toBeFocused();
    await picker.getByRole("button", { name: "Close skills" }).click();
    await expect(picker).toBeHidden();
  });
});
