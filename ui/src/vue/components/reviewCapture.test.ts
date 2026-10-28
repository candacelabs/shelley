// DOM resolution for review recordings: breadcrumbs from data-review labels,
// Pierre diff rows inside shadow roots, and selections within diffs.
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<main id="root">
  <div data-review="Tour">
    <section data-review="Commit message" data-review-item><h2 id="subject">Fix the bug</h2></section>
    <article id="chunk" data-review="The fix › app.ts · 10–12" data-review-file="src/app.ts" data-review-item>
      <div data-review="narration"><p id="prose">This line   is the culprit.</p></div>
      <diffs-container id="host"></diffs-container>
      <button id="toggle" aria-label="Show full src/app.ts">⤢</button>
    </article>
    <section data-review="Notes">
      <p id="long">The recorder keeps every chunk in IndexedDB until the conversation accepts it, so a crash loses nothing. Stopping flushes the last chunk and the pointer timeline. Cancelling instead deletes <code>the stored session</code> outright and never uploads, which is why it asks twice before throwing anything away for good.</p>
      <pre id="body">first line
second   line here
third</pre>
      <div id="meta"><span id="author">Review Test</span></div>
      <ul><li id="run-on">${Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ")}</li></ul>
    </section>
  </div>
</main>`);
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  ShadowRoot: dom.window.ShadowRoot,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
});

const { breadcrumb, collapse, describeNode, describeSelection, pointedText } =
  await import("./reviewCapture");

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`\u2713 ${name}`);
  } catch (err) {
    console.error(`\u2717 ${name}`);
    throw err;
  }
}

const host = document.getElementById("host")!;
const shadow = host.attachShadow({ mode: "open" });
shadow.innerHTML = `<pre><code data-deletions="">
  <div data-column-number="10" data-line-type="change-deletion" data-line-index="9,9"><span>10</span></div>
  <div id="old10" data-line="10" data-line-type="change-deletion" data-line-index="9,9"><span>return   a;</span></div>
</code><code data-additions="">
  <div id="new11" data-line="11" data-alt-line="10" data-line-type="context" data-line-index="10,10"><span>  x();</span></div>
  <div id="new12" data-line="12" data-line-type="change-addition" data-line-index="11,11"><span>return b;</span></div>
</code><code data-unified="">
  <div id="unifiedContext" data-line="20" data-alt-line="18" data-line-type="context"><span>ctx</span></div>
</code></pre>`;

run("collapses whitespace and truncates", () => {
  assertEqual(collapse("  a \n  b  "), "a b", "collapse");
  assertEqual(collapse("abcdef", 4), "abc\u2026", "truncate");
});

run("breadcrumbs cross shadow roots", () => {
  assertEqual(
    breadcrumb(shadow.getElementById("new12")),
    ["Tour", "The fix › app.ts · 10–12"],
    "labels outermost first",
  );
});

run("describes diff rows by file, side, and line", () => {
  assertEqual(
    describeNode(shadow.getElementById("old10")!.firstChild),
    {
      where: "Tour › The fix › app.ts · 10–12 › old 10",
      file: "src/app.ts",
      side: "old",
      line: 10,
      text: "return a;",
    },
    "deletion row",
  );
  assertEqual(
    describeNode(shadow.getElementById("new11"))?.side,
    "new",
    "context row in additions column",
  );
  assertEqual(
    describeNode(shadow.getElementById("unifiedContext"))?.where.endsWith("new 20"),
    true,
    "unified context uses the new line",
  );
});

run("gutter numbers resolve to their row's code", () => {
  const gutter = shadow.querySelector("[data-column-number]")!;
  assertEqual(describeNode(gutter)?.text, "return a;", "gutter text");
  assertEqual(describeNode(gutter)?.line, 10, "gutter line");
});

run("describes prose, controls, and labelled regions", () => {
  assertEqual(
    describeNode(document.getElementById("prose")!.firstChild),
    { where: "Tour › The fix › app.ts · 10–12 › narration", text: "This line is the culprit." },
    "prose block",
  );
  assertEqual(
    describeNode(document.getElementById("toggle")),
    { where: 'Tour › The fix › app.ts · 10–12 › "Show full src/app.ts"' },
    "control",
  );
  assertEqual(
    describeNode(document.getElementById("subject")),
    { where: "Tour › Commit message", text: "Fix the bug" },
    "heading",
  );
});

run("narrows long text to what is under the pointer", () => {
  const long = document.getElementById("long")!;
  const [opening, code, closing] = Array.from(long.childNodes);
  const caret = (node: ChildNode, word: string) => ({
    node: node as Text,
    offset: node.textContent!.indexOf(word),
  });
  assertEqual(
    pointedText(long, caret(opening, "flushes")),
    "Stopping flushes the last chunk and the pointer timeline.",
    "sentence",
  );
  assertEqual(
    pointedText(long, caret(closing, "asks")),
    "Cancelling instead deletes the stored session outright and never uploads, which is why it asks twice before throwing anything away for good.",
    "sentence across inline elements",
  );
  assertEqual(
    pointedText(long, caret(code.firstChild!, "stored")),
    pointedText(long, caret(closing, "asks")),
    "caret inside inline code",
  );
  assertEqual(pointedText(long, null).endsWith("\u2026"), true, "no caret: the clipped block");
  const body = document.getElementById("body")!.firstChild!;
  assertEqual(
    pointedText(document.getElementById("body")!, caret(body, "here")),
    "second line here",
    "preformatted line",
  );
  const prose = document.getElementById("prose")!;
  assertEqual(
    pointedText(prose, caret(prose.firstChild!, "culprit")),
    "This line is the culprit.",
    "short block stays whole",
  );
  const runOn = document.getElementById("run-on")!.firstChild!;
  const clipped = pointedText(runOn.parentElement!, caret(runOn, "word50"));
  assertEqual(
    [clipped.length <= 200, clipped.startsWith("…"), clipped.includes("word50")],
    [true, true, true],
    "overlong sentence clips around the pointer",
  );
  const offsets = [0, 1, 2, 3, 4].map((i) => ({ node: runOn as Text, offset: 150 + i }));
  assertEqual(
    new Set(offsets.map((c) => pointedText(runOn.parentElement!, c))).size,
    1,
    "the clip holds still as the pointer moves along",
  );
  const author = document.getElementById("author")!;
  assertEqual(
    describeNode(author, { node: author.firstChild as Text, offset: 2 }),
    { where: "Tour › Notes", text: "Review Test" },
    "text outside a block",
  );
  assertEqual(describeNode(author), { where: "Tour › Notes" }, "no caret, no block");
});

run("off-row diff content is just its region", () => {
  assertEqual(
    describeNode(shadow.querySelector("pre")),
    { where: "Tour › The fix › app.ts · 10–12" },
    "pre",
  );
});

// jsdom cannot select inside shadow roots; e2e covers diff-row selections.
run("describes a selection and its clearing", () => {
  const selection = window.getSelection()!;
  const text = document.getElementById("prose")!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 9);
  selection.removeAllRanges();
  selection.addRange(range);
  assertEqual(
    describeSelection(document.getElementById("root")!),
    { where: "Tour › The fix › app.ts · 10–12 › narration", text: "This line" },
    "prose selection",
  );
  selection.removeAllRanges();
  assertEqual(describeSelection(document.getElementById("root")!), null, "cleared selection");
});
