import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { addCodeBlockHeaders, codeBlockText, setCodeBlockCopied } from "./codeBlockCopy";

const dom = new JSDOM();
Object.assign(globalThis, {
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLButtonElement: dom.window.HTMLButtonElement,
});

const root = document.createElement("div");
root.innerHTML = [
  '<pre><code class="language-bash">ssh-keygen --long-option\n</code></pre>',
  "<pre><code>ssh-ed25519 AAAAC3...\n</code></pre>",
].join("");

addCodeBlockHeaders(root);
addCodeBlockHeaders(root);

const blocks = root.querySelectorAll(".shelley-code-block");
assert.equal(blocks.length, 2, "each fenced block is wrapped once");
assert.equal(blocks[0].querySelector(".shelley-code-header span")?.textContent, "bash");
assert.equal(blocks[1].querySelector(".shelley-code-header span")?.textContent, "text");

const button = blocks[0].querySelector<HTMLButtonElement>(".shelley-code-copy");
assert(button);
assert.equal(codeBlockText(button), "ssh-keygen --long-option");
assert.equal(button.getAttribute("aria-label"), "Copy code");

setCodeBlockCopied(button, true);
assert(button.classList.contains("shelley-code-copy-success"));
assert.equal(button.getAttribute("aria-label"), "Code copied");
assert.equal(button.dataset.tooltip, "Copied");

setCodeBlockCopied(button, false);
assert(!button.classList.contains("shelley-code-copy-success"));
assert.equal(button.getAttribute("aria-label"), "Copy code");
