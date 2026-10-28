import { test, expect } from "@playwright/test";
import { createConversationViaAPIWithDetails } from "./helpers";

// Autoscroll while @pierre/diffs render.
//
// A patch tool's diff is not at its final height when the message arrives: the
// FileDiff renderer tokenizes in a worker and only then builds shadow DOM, so a
// tall diff keeps growing the message list for many frames afterwards. Until
// then PatchTool holds the space with a min-height placeholder.
//
// The bug this covers: the placeholder used to be dropped as soon as hydrate()
// was called, which is *before* the worker comes back. For that window the host
// had neither a placeholder nor content, so it collapsed to zero height and
// then re-expanded to the real height a few frames later. Chromium hides this
// because its scroll anchoring restores the offset exactly across such a
// round trip; WebKit's does not, so on Safari every diff that scrolled by
// knocked the viewport up by roughly a placeholder's worth and stranded the
// reader mid-diff with the scroll-to-bottom button showing. Run with
// PW_WEBKIT=1 to exercise the engine where it actually reproduced.
test.describe("Autoscroll with pierre diffs", () => {
  test("stays pinned to the bottom while tall diffs hydrate", async ({ page, request }) => {
    const { conversationId, slug } = await createConversationViaAPIWithDetails(
      request,
      "echo seed",
    );

    await page.goto(`/c/${slug}`);
    await page.waitForLoadState("domcontentloaded");
    const messagesContainer = page.locator(".messages-container");
    await expect(page.locator('[data-testid="message-input"]')).toBeVisible({ timeout: 30000 });
    await expect(messagesContainer).toBeVisible({ timeout: 30000 });

    // Sample every diff host once per frame, looking for the bad state itself:
    // no placeholder holding the space *and* no rendered diff to fill it. That
    // is the transient zero-height gap the fix removes, and it is what WebKit
    // cannot scroll-anchor its way back out of.
    //
    // Per-frame rather than a timer, and looking for a state rather than a
    // transition: pre-fix the gap lasts ~500ms (tens of frames), so it is caught
    // with a wide margin, whereas sampling on an interval raced the swap and
    // missed it for some diffs entirely.
    //
    // The rendered <pre> is the signal for "the diff is really there". The
    // shadow root is not: <diffs-container> attaches it in its constructor, and
    // hydrate() immediately fills it with ~8KB of stylesheet and sprite markup,
    // so both its existence and its size look "rendered" long before any code
    // has been laid out.
    await page.evaluate(() => {
      const w = window as Window & { __emptyGaps?: number; __sampledHosts?: Set<Element> };
      w.__emptyGaps = 0;
      w.__sampledHosts = new Set();
      const sample = () => {
        for (const host of document.querySelectorAll(".patch-tool-diff-host")) {
          w.__sampledHosts!.add(host);
          const holdingSpace = !!(host as HTMLElement).style.minHeight;
          const hasDiff = !!host.querySelector("diffs-container")?.shadowRoot?.querySelector("pre");
          if (!holdingSpace && !hasDiff) w.__emptyGaps!++;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    const gap = () =>
      messagesContainer.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);

    // Several turns, each ending in a tall diff, posted over the API so the page
    // receives them on the stream the way a real session does.
    for (let turn = 0; turn < 4; turn++) {
      const hydratedBefore = await page.locator(".patch-tool").count();
      const resp = await request.post(`/api/conversation/${conversationId}/chat`, {
        data: { message: "big patch", model: "predictable" },
      });
      expect(resp.ok(), `chat failed: ${resp.status()}`).toBeTruthy();

      await expect
        .poll(() => page.locator(".patch-tool").count(), { timeout: 30000 })
        .toBe(hydratedBefore + 1);
      // Wait for the worker to have actually produced DOM. The shadow root
      // itself is no signal: <diffs-container> attaches it in its constructor,
      // so it exists from the moment mount() creates the element. Its content is
      // what arrives late, and only then has the list really grown.
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                Array.from(document.querySelectorAll("diffs-container")).filter(
                  (el) => (el.shadowRoot?.innerHTML.length ?? 0) > 0,
                ).length,
            ),
          { timeout: 30000 },
        )
        .toBe(hydratedBefore + 1);

      // The point of the test: once the diff has settled we must be back at the
      // bottom. Polled so a mid-hydration sample can't fail spuriously, but it
      // has to genuinely get there.
      await expect.poll(gap, { timeout: 15000 }).toBeLessThan(120);
    }

    // Never scrolled away, so the button must not exist. toHaveCount(0) rather
    // than not.toBeVisible(), which absence also satisfies and which would
    // therefore pass just as happily if the whole nav cluster failed to render.
    await expect(page.locator(".scroll-to-bottom-button")).toHaveCount(0);

    // The underlying invariant: no diff host was ever left without a placeholder
    // and without a rendered diff. The assertions above are what the user feels
    // when this breaks; this is the mechanism. Pre-fix this counts in the
    // hundreds (every diff spends ~500ms in that state).
    const { emptyGaps, sampledHosts } = await page.evaluate(() => {
      const w = window as Window & { __emptyGaps?: number; __sampledHosts?: Set<Element> };
      return { emptyGaps: w.__emptyGaps ?? -1, sampledHosts: w.__sampledHosts?.size ?? 0 };
    });
    // Guard against a sampler that never ran, which would make the check
    // vacuous: it must have seen every turn's diff host. Not a frame count:
    // how many frames a run lasts depends on machine speed and load.
    expect(sampledHosts, "sampler missed diff hosts").toBeGreaterThanOrEqual(4);
    expect(emptyGaps, "diff host left with neither placeholder nor content").toBe(0);
  });

  test("keeps the bottom when a tool card replaces its placeholder", async ({ page, request }) => {
    // A completed tool card mounts in place of a placeholder once it nears the
    // viewport, and Vue removes the placeholder before mounting the card. A
    // layout forced while the card set up (PatchTool read window.innerWidth)
    // saw the transcript short by the placeholder's height and clamped the
    // scroll offset at the bottom. The list was back to full height by the
    // next ResizeObserver report, so nothing explained the drop; when the
    // scroll event beat the card's growth it read as the reader scrolling
    // away, and the diff hydrated below a transcript that no longer followed.
    // Hold the placeholder's near-viewport report to swap it on cue.
    await page.addInitScript(() => {
      const Native = window.IntersectionObserver;
      const held: Array<() => void> = [];
      let holding = true;
      Object.assign(window, {
        releaseToolCards: () => {
          holding = false;
          for (const deliver of held.splice(0)) deliver();
        },
      });
      window.IntersectionObserver = class extends Native {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super((entries, observer) => {
            const pass = entries.filter(
              (e) => !holding || !e.target.matches(".tool-card-mount-placeholder"),
            );
            const hold = entries.filter((e) => !pass.includes(e));
            if (hold.length) held.push(() => callback(hold, observer));
            if (pass.length) callback(pass, observer);
          }, options);
        }
      };
    });
    const { conversationId, slug } = await createConversationViaAPIWithDetails(
      request,
      "echo seed",
    );
    const resp = await request.post(`/api/conversation/${conversationId}/chat`, {
      data: { message: "big patch", model: "predictable" },
    });
    expect(resp.ok(), `chat failed: ${resp.status()}`).toBeTruthy();
    // Both turns done, so the page loads the patch as a completed card.
    await expect
      .poll(async () => {
        const r = await request.get(`/api/conversation/${conversationId}`);
        const { messages } = (await r.json()) as {
          messages: { type: string; end_of_turn?: boolean }[];
        };
        return messages.filter((m) => m.type === "agent" && m.end_of_turn).length;
      })
      .toBe(2);

    await page.goto(`/c/${slug}`);
    const container = page.locator(".messages-container");
    const placeholder = page.locator(".tool-card-mount-placeholder--patch");
    await expect(placeholder).toBeAttached({ timeout: 30000 });
    const gap = () => container.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    await expect.poll(gap).toBeLessThan(2);
    // Without the placeholder the transcript would end above the current
    // offset: the case that clamped.
    expect(
      await placeholder.evaluate((el, maxGap) => (el as HTMLElement).offsetHeight > maxGap, 2),
    ).toBe(true);

    const swap = await container.evaluate(async (el) => {
      const before = el.scrollTop;
      (window as unknown as { releaseToolCards(): void }).releaseToolCards();
      // Vue's scheduler flushed on a microtask queued during the release, so
      // the card is in place before this continuation; no frame has run yet.
      await Promise.resolve();
      return { before, after: el.scrollTop, mounted: !!el.querySelector(".patch-tool") };
    });
    expect(swap).toEqual({ before: swap.before, after: swap.before, mounted: true });
    expect(swap.before).toBeGreaterThan(0);

    await expect(page.locator(".patch-tool diffs-container")).toBeAttached();
    await expect.poll(gap, { timeout: 15000 }).toBeLessThan(120);
    await expect(page.locator(".scroll-to-bottom-button")).toHaveCount(0);
  });

  test("a diff with no hunks does not strand its placeholder", async ({ page, request }) => {
    // Guards the zero-hunks branch of watchForLayout, not the original bug:
    // holding the placeholder until the diff reports a height strands it forever
    // on a diff that will never have one. (So unlike the test above, this one is
    // green against the pre-fix code, which dropped every placeholder eagerly.
    // It fails if the observer is kept but the zero-hunks branch is dropped.)
    //
    // A no-op patch is that case: the tool still emits a unified diff, so
    // PatchTool renders a host, but it has no hunks, and with disableFileHeader
    // FileDiff renders nothing at all and the container stays 0px.
    //
    // Two identical overwrites in one conversation. The second is a no-op
    // whatever the file held beforehand, which matters because the fixture
    // writes a fixed path that earlier runs may have already created.
    const { conversationId, slug } = await createConversationViaAPIWithDetails(
      request,
      "patch success",
    );
    const second = await request.post(`/api/conversation/${conversationId}/chat`, {
      data: { message: "patch success", model: "predictable" },
    });
    expect(second.ok(), `second patch failed: ${second.status()}`).toBeTruthy();

    await page.goto(`/c/${slug}`);
    await page.waitForLoadState("domcontentloaded");
    // The no-op diff renders nothing, so the host is attached but zero-height
    // (not "visible" to Playwright) — which is the state under test.
    const host = page.locator(".patch-tool-diff-host").nth(1);
    await expect(host).toBeAttached({ timeout: 30000 });

    // The assertion under test: the placeholder must be released. Polled,
    // because hydration is async — the failure mode being guarded against is it
    // never happening at all.
    await expect
      .poll(() => host.evaluate((el) => (el as HTMLElement).style.minHeight || "-"), {
        timeout: 15000,
      })
      .toBe("-");

    // Guard against passing vacuously: the diff must really have hydrated (the
    // container exists) and really have rendered nothing (no <pre>). Emptiness
    // has to be judged on the <pre>, not the shadow root, which exists from
    // construction and holds sprite/stylesheet markup for real diffs.
    expect(
      await host.evaluate((el) => {
        const container = el.querySelector("diffs-container");
        return {
          hydrated: !!container?.shadowRoot,
          renderedDiff: !!container?.shadowRoot?.querySelector("pre"),
        };
      }),
    ).toEqual({ hydrated: true, renderedDiff: false });
  });
});
