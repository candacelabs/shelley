import { expect, test } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chooseTerminalMenuItem,
  closeTerminalsIn,
  createConversationViaAPIWithDetails,
  setPageTerminalRenderer,
  testWorkingDirectory,
} from "./helpers";

// nvim asks whether the terminal speaks the kitty keyboard protocol and, if it
// does, turns it on. xterm.js 6 then encodes Cmd+V as a key report (nvim shows
// `<D-v>`) and cancels the event, so Safari never pastes. The terminal must
// not answer, and Cmd+V must stay with the browser. So must other Cmd
// shortcuts, the browser's and the app's (recorded where the app listens).
for (const renderer of ["ghostty", "xterm"] as const) {
  test(`macOS Cmd+V reaches the browser when an app asks for the kitty keyboard protocol (${renderer})`, async ({
    page,
    request,
  }) => {
    await setPageTerminalRenderer(page, renderer);
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
      const w = window as unknown as { cmdKeydowns: Array<{ key: string; prevented: boolean }> };
      w.cmdKeydowns = [];
      window.addEventListener("keydown", (e) => {
        if (!e.metaKey || e.key === "Meta") return;
        setTimeout(() => w.cmdKeydowns.push({ key: e.key, prevented: e.defaultPrevented }));
      });
    });

    // Ask for the kitty protocol the way nvim does, then report raw input (the
    // terminal's reply included) up to "q".
    const cwd = mkdtempSync(join(testWorkingDirectory(), "terminal-kitty-"));
    try {
      writeFileSync(
        join(cwd, "keys.sh"),
        [
          "stty raw -echo",
          "printf '\\033[?u\\033[>1u'",
          "printf 'kitty-ready\\r\\n'",
          "IFS= read -r -d q keys",
          "stty sane",
          "printf '\\033[<u'",
          "printf 'keys=%q\\n' \"$keys\"",
          "",
        ].join("\n"),
      );
      const { conversationId } = await createConversationViaAPIWithDetails(
        request,
        "terminal mac clipboard test",
        { cwd },
      );
      await page.goto(`/c/${conversationId}`);
      const input = page.getByTestId("message-input");
      await input.fill("!bash keys.sh");
      await page.getByTestId("send-button").click();

      await expect
        .poll(async () => {
          await chooseTerminalMenuItem(page, "Insert all output into input");
          return input.inputValue();
        })
        .toMatch(/kitty-ready/);
      await input.fill("");

      const terminalInput = page.getByRole("textbox", { name: "Terminal input", exact: true });
      await terminalInput.press("Meta+v");
      await terminalInput.press("Meta+c");
      await terminalInput.press("Meta+l");
      await terminalInput.press("q");

      await expect(page.locator(".terminal-panel-tab-success")).toHaveCount(1);
      await chooseTerminalMenuItem(page, "Insert all output into input");
      await expect(input).toHaveValue(/keys=''/);
      expect(
        await page.evaluate(() => (window as unknown as { cmdKeydowns: unknown[] }).cmdKeydowns),
      ).toEqual([
        { key: "v", prevented: false },
        { key: "c", prevented: false },
        { key: "l", prevented: false },
      ]);
    } finally {
      await closeTerminalsIn(request, cwd);
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
