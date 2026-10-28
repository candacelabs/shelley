import { expect, test, type Page } from "@playwright/test";
import type { McpServer } from "../src/services/api";

const servers: McpServer[] = [
  {
    name: "kagi",
    url: "https://kagi-mcp.int.exe.xyz/mcp",
    description: "Integration-managed authentication",
    headers: {},
    auth: "",
    integration: "kagi-mcp",
  },
  {
    name: "keyed",
    url: "https://keyed.example.test/mcp",
    description: "Static API key",
    headers: { Authorization: "Bearer key" },
    auth: "",
  },
  {
    name: "oauth",
    url: "https://oauth.example.test/mcp",
    description: "Direct OAuth",
    headers: {},
    auth: "login_required",
    login_url: "/mcp/login/oauth",
  },
  {
    name: "logged-in",
    url: "https://logged-in.example.test/mcp",
    description: "Direct OAuth with a stored login",
    headers: {},
    auth: "logged_in",
    login_url: "/mcp/login/logged-in",
  },
];

async function openPanel(page: Page) {
  await page.goto("/new");
  await page.keyboard.press("Control+k");
  await page.locator(".command-palette-input").fill("MCP Servers");
  await page.locator(".command-palette-item").first().click();
  const panel = page.getByRole("dialog", { name: "MCP Servers", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

test("integration-managed servers have no login, edit, or delete controls", async ({ page }) => {
  await page.route("**/api/mcp/servers", (route) => route.fulfill({ json: servers }));
  const panel = await openPanel(page);
  for (const name of ["kagi", "keyed"]) {
    const row = panel.getByRole("row").filter({
      has: page.getByText(name, { exact: true }),
    });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: "Log in", exact: true })).toHaveCount(0);
  }
  await expect(panel.getByRole("link", { name: "Log in", exact: true })).toHaveAttribute(
    "href",
    "/mcp/login/oauth",
  );
  await expect(panel.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Delete kagi", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Edit kagi", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Delete keyed", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Delete oauth", exact: true })).toBeVisible();
});

test("refresh clears errors and reloads servers with a loading state", async ({ page }) => {
  let response: "error" | "pending" | "success" = "error";
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/mcp/servers", async (route) => {
    if (response === "error") {
      await route.fulfill({ status: 502, body: "Integration discovery failed" });
      return;
    }
    if (response === "pending") await pending;
    await route.fulfill({ json: servers.slice(0, 2) });
  });
  const panel = await openPanel(page);
  const refresh = panel.getByRole("button", { name: "Refresh", exact: true });
  await expect(panel.getByRole("alert")).toContainText("Integration discovery failed");
  response = "pending";
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(panel.locator(".models-loading")).toBeVisible();
  response = "success";
  release();
  await expect(panel.getByText("kagi", { exact: true })).toBeVisible();
  await expect(refresh).toBeEnabled();
  await expect(panel.getByRole("columnheader", { name: "Login", exact: true })).toHaveCount(0);
});

test("refresh removes pending deletion when an integration takes ownership", async ({ page }) => {
  let managed = false;
  await page.route("**/api/mcp/servers", (route) =>
    route.fulfill({
      json: [{ ...servers[0], integration: managed ? "kagi-mcp" : undefined }],
    }),
  );
  const panel = await openPanel(page);
  await panel.getByRole("button", { name: "Delete kagi", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  managed = true;
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(panel.getByText("kagi", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
});
