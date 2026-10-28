import { expect, test, type WebSocketRoute } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chooseTerminalMenuItem,
  createConversationViaAPIWithDetails,
  testWorkingDirectory,
} from "./helpers";

test("opens terminals for bare shell commands", async ({ page, request }) => {
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal composer test",
  );
  await page.goto(`/c/${conversationId}`);

  const input = page.getByTestId("message-input");
  await input.fill("!");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab")).toHaveCount(1);
  await expect(input).toHaveValue("");

  await input.fill("/shell");
  await expect(input).toHaveValue("!");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab")).toHaveCount(2);
  await expect(input).toHaveValue("");
});

for (const command of ["!", "/shell", "!bash", "!/bin/bash -i"]) {
  test(`${command} closes its terminal tab after EOF`, async ({ page, request }) => {
    const { conversationId } = await createConversationViaAPIWithDetails(
      request,
      "terminal EOF test",
    );
    await page.goto(`/c/${conversationId}`);
    const input = page.getByTestId("message-input");
    await input.fill(command);
    await page.getByTestId("send-button").click();
    await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(1);

    const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
    // Readline handles EOF at an empty prompt. Synchronize with the shell by
    // waiting for a marker in real terminal output, not just the open socket.
    await terminalInput.pressSequentially("printf 'shell-ready\\n'");
    await terminalInput.press("Enter");
    await expect
      .poll(async () => {
        await chooseTerminalMenuItem(page, "Insert all output into input");
        return input.inputValue();
      })
      .toMatch(/shell-ready\r?\n/);
    await terminalInput.press("Control+d");

    await expect(page.locator(".terminal-panel-tab")).toHaveCount(0);
    await expect(page.locator(".terminal-panel")).toBeHidden();
    await expect
      .poll(async () => {
        const terminals: Array<{ conversation_id: string | null }> = await (
          await request.get("/api/terminals")
        ).json();
        return terminals.filter((terminal) => terminal.conversation_id === conversationId).length;
      })
      .toBe(0);
    await page.reload();
    await expect(page.locator(".terminal-panel-tab")).toHaveCount(0);
  });
}

test("shell exit closes only its own tab, keeping command output", async ({ page, request }) => {
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal exit test",
  );
  await page.goto(`/c/${conversationId}`);
  const input = page.getByTestId("message-input");
  await input.fill("!printf preserved-output");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab-success")).toHaveCount(1);

  await input.fill("!");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(1);
  const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
  await terminalInput.pressSequentially("exit 0");
  await terminalInput.press("Enter");

  await expect(page.locator(".terminal-panel-tab")).toHaveCount(1);
  await expect(page.locator(".terminal-panel-tab-active")).toHaveAttribute(
    "title",
    "printf preserved-output",
  );
  await chooseTerminalMenuItem(page, "Insert all output into input");
  await expect(input).toHaveValue(/preserved-output/);
});

test("closes direct shell launches on nonzero exits", async ({ page, request }) => {
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal failed exit test",
  );
  await page.goto(`/c/${conversationId}`);
  await page.getByTestId("message-input").fill("!bash");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(1);
  const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
  await terminalInput.pressSequentially("exit 7");
  await terminalInput.press("Enter");
  await expect(page.locator(".terminal-panel-tab")).toHaveCount(0);
  await expect(page.locator(".terminal-panel")).toBeHidden();
});

test("restores each terminal's explicit exit policy after reload", async ({ page, request }) => {
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal exit policy test",
  );
  await page.goto(`/c/${conversationId}`);
  const input = page.getByTestId("message-input");
  const heldCommand = "bash -c 'read -r answer; echo \"$answer\"'";
  for (const command of [`!${heldCommand}`, "!bash"]) {
    await input.fill(command);
    await page.getByTestId("send-button").click();
  }
  await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(2);
  await expect
    .poll(async () => {
      const terminals: Array<{ conversation_id: string | null; close_on_exit: boolean }> = await (
        await request.get("/api/terminals")
      ).json();
      return terminals
        .filter((terminal) => terminal.conversation_id === conversationId)
        .map((terminal) => terminal.close_on_exit);
    })
    .toEqual([false, true]);

  await page.reload();
  await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(2);
  const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
  await terminalInput.pressSequentially("exit 7");
  await terminalInput.press("Enter");
  await expect(page.locator(".terminal-panel-tab")).toHaveCount(1);
  await expect(page.locator(".terminal-panel-tab-active")).toHaveAttribute("title", heldCommand);

  // A shell running a one-shot command retains output even though its
  // executable is the same as the interactive shell that just closed.
  await terminalInput.pressSequentially("retained-after-reload");
  await terminalInput.press("Enter");
  await expect(page.locator(".terminal-panel-tab-success")).toHaveCount(1);
  await chooseTerminalMenuItem(page, "Insert all output into input");
  await expect(input).toHaveValue(/retained-after-reload/);
});

test("keeps one-shot bash output visible", async ({ page, request }) => {
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal one-shot shell test",
  );
  await page.goto(`/c/${conversationId}`);
  await page.getByTestId("message-input").fill("!bash -c 'echo one-shot-output'");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab-success")).toHaveCount(1);
  await chooseTerminalMenuItem(page, "Insert all output into input");
  await expect(page.getByTestId("message-input")).toHaveValue(/one-shot-output/);
});

test("keeps bash script output visible", async ({ page, request }) => {
  const cwd = mkdtempSync(join(testWorkingDirectory(), "terminal-script-"));
  try {
    writeFileSync(join(cwd, "script.sh"), "echo script-output\n");
    const { conversationId } = await createConversationViaAPIWithDetails(
      request,
      "terminal shell script test",
      { cwd },
    );
    await page.goto(`/c/${conversationId}`);
    await page.getByTestId("message-input").fill("!bash script.sh");
    await page.getByTestId("send-button").click();
    await expect(page.locator(".terminal-panel-tab-success")).toHaveCount(1);
    await chooseTerminalMenuItem(page, "Insert all output into input");
    await expect(page.getByTestId("message-input")).toHaveValue(/script-output/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("keeps failed command output visible", async ({ page, request }) => {
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal command failure test",
  );
  await page.goto(`/c/${conversationId}`);
  await page.getByTestId("message-input").fill("!false");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab-error")).toHaveCount(1);
  await chooseTerminalMenuItem(page, "Insert all output into input");
  await expect(page.getByTestId("message-input")).toHaveValue(/completed with exit\s+code 1/);
});

test("does not treat a disconnected socket as a shell exit", async ({ page, request }) => {
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal disconnect test",
  );
  let terminalSocket: WebSocketRoute | undefined;
  await page.routeWebSocket(/\/api\/exec-ws\?/, (socket) => {
    socket.connectToServer();
    if (new URL(socket.url()).searchParams.get("conversation_id") === conversationId) {
      terminalSocket = socket;
    }
  });
  await page.goto(`/c/${conversationId}`);
  await page.getByTestId("message-input").fill("!");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(1);
  expect(terminalSocket).toBeDefined();
  await terminalSocket!.close();
  await expect(page.locator(".terminal-panel-tab-error")).toHaveCount(1);

  await page.reload();
  await expect(page.locator(".terminal-panel-tab-running")).toHaveCount(1);
  const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
  await terminalInput.pressSequentially("exit");
  await terminalInput.press("Enter");
  await expect(page.locator(".terminal-panel-tab")).toHaveCount(0);
});

test("keeps terminal launch errors visible", async ({ page, request }) => {
  const { conversationId } = await createConversationViaAPIWithDetails(
    request,
    "terminal launch failure test",
  );
  // Exercise a real server launch failure without changing the conversation's
  // working directory or breaking the agent fixture. A missing cwd falls back
  // to the default, so ask for a terminal session that doesn't exist instead.
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const address = new URL(url, window.location.href);
        if (address.pathname === "/api/exec-ws" && address.searchParams.has("cmd")) {
          address.searchParams.set("term_id", "nonexistent-shelley-terminal-test-session");
        }
        super(address, protocols);
      }
    };
  });
  await page.goto(`/c/${conversationId}`);
  await page.getByTestId("message-input").fill("!");
  await page.getByTestId("send-button").click();
  await expect(page.locator(".terminal-panel-tab-error")).toHaveCount(1);
  await chooseTerminalMenuItem(page, "Insert all output into input");
  await expect(page.getByTestId("message-input")).toHaveValue(/Error:/);
});
