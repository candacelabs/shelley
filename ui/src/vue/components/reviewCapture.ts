// Timestamped capture of what a reviewer sees, points at, and selects while
// narrating a recording. Times are milliseconds from the audio start (t0), so
// the server can interleave them with word timings. The DOM is described via
// `data-review` labels (outermost to innermost form a breadcrumb), Pierre diff
// rows (data-line inside the diff's shadow root), and nearby block text.
// Content the DOM cannot describe (Monaco's virtualized editor) is supplied
// by the ReviewContext hooks.

export type ReviewSide = "old" | "new";

export interface ReviewTarget {
  where: string;
  file?: string;
  side?: ReviewSide;
  line?: number;
  end_line?: number;
  text?: string;
}

export interface ReviewView {
  where: string;
  mode: string;
  commit?: string;
  file?: string;
}

export type ReviewEvent = { ms: number; type: string } & Partial<ReviewTarget> &
  Partial<ReviewView> & {
    items?: string[];
    scroll_top?: number;
    open?: boolean;
    state?: string;
  };

export interface ReviewContext {
  view(): ReviewView;
  // undefined defers to DOM resolution; null means "nothing there".
  pointAt?(x: number, y: number, element: Element): ReviewTarget | null | undefined;
  selection?(): ReviewTarget | null | undefined;
  onScreen?(): string[] | undefined;
}

export interface ReviewCaptureState {
  pointer: string;
  // The text under the pointer (a line, sentence, or short block).
  pointerText: string;
  selection: string;
  // First region on screen; what touch users see, with no pointer.
  screen: string;
  view: string;
}

const BLOCK_SELECTOR =
  "p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,summary,dt,dd,figcaption,label,button,a,select,[role=option],[role=treeitem]";
const POINTER_TEXT_LIMIT = 200;
const SELECTION_TEXT_LIMIT = 4000;

export function clipSelection(text: string): string {
  return text.length > SELECTION_TEXT_LIMIT ? `${text.slice(0, SELECTION_TEXT_LIMIT)}…` : text;
}

export function collapse(text: string | null | undefined, limit = POINTER_TEXT_LIMIT): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

// Parent across shadow boundaries.
function composedParent(node: Node): Node | null {
  if (node.parentNode instanceof ShadowRoot) return node.parentNode.host;
  return node.parentNode;
}

function composedContains(root: Node, node: Node | null): boolean {
  for (let current = node; current; current = composedParent(current)) {
    if (current === root) return true;
  }
  return false;
}

function composedClosest(node: Node | null, selector: string): Element | null {
  for (let current = node; current; current = composedParent(current)) {
    if (current instanceof Element && current.matches(selector)) return current;
  }
  return null;
}

export function breadcrumb(node: Node | null): string[] {
  const labels: string[] = [];
  for (let current = node; current; current = composedParent(current)) {
    if (current instanceof HTMLElement && current.dataset.review)
      labels.unshift(current.dataset.review);
  }
  return labels;
}

interface DiffRow {
  row: Element;
  file?: string;
  side: ReviewSide;
  line: number;
}

// A Pierre diff row (code line or its gutter number) containing node.
function diffRow(node: Node | null): DiffRow | null {
  const row = composedClosest(node, "[data-line],[data-column-number]");
  if (!row || !(row.getRootNode() instanceof ShadowRoot)) return null;
  const line = Number(row.getAttribute("data-line") ?? row.getAttribute("data-column-number"));
  if (!Number.isFinite(line)) return null;
  const type = row.getAttribute("data-line-type") ?? "";
  const code = row.closest("code");
  let side: ReviewSide = "new";
  if (code?.hasAttribute("data-deletions") || type === "change-deletion") side = "old";
  const file = (composedClosest(row, "[data-review-file]") as HTMLElement | null)?.dataset
    .reviewFile;
  return { row, file, side, line };
}

// The code text of a gutter or content row, found by its line index.
function diffRowText(row: DiffRow): string {
  if (row.row.hasAttribute("data-line")) return row.row.textContent ?? "";
  const index = row.row.getAttribute("data-line-index");
  const code = row.row.closest("code");
  const content = index ? code?.querySelector(`[data-line][data-line-index="${index}"]`) : null;
  return content?.textContent ?? "";
}

function joinWhere(labels: string[], leaf?: string): string {
  return [...labels, ...(leaf ? [leaf] : [])].join(" › ");
}

function elementLabel(element: Element): string {
  return collapse(
    element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("data-tooltip") ||
      element.textContent,
    80,
  );
}

export interface Caret {
  node: Text;
  offset: number;
}

// The character under a viewport point. The caret APIs snap to the nearest
// text, so this checks the point is on the glyph itself.
export function caretAt(x: number, y: number): Caret | null {
  let node: Node | null = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y);
    node = position?.offsetNode ?? null;
    offset = position?.offset ?? 0;
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  if (!(node instanceof Text)) return null;
  const range = document.createRange();
  // The caret sits between characters: the glyph is on either side of it.
  for (const at of [offset, offset - 1]) {
    if (at < 0 || at >= node.length) continue;
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
        return { node, offset: at };
    }
  }
  return null;
}

// ES2022's Intl.Segmenter, where the browser has it.
type SentenceSegmenter = {
  segment(text: string): {
    containing(index: number): { segment: string; index: number } | undefined;
  };
};
const Segmenter = (
  Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: "sentence" }) => SentenceSegmenter;
  }
).Segmenter;
let sentences: SentenceSegmenter | null = null;

// text collapsed, or when too long, the stretch of it around index at.
// Stretches start at fixed steps, so the text (and with it the pointer
// event) changes every hundred characters, not with every one.
function around(text: string, at: number): string {
  const value = collapse(text, Infinity);
  if (value.length <= POINTER_TEXT_LIMIT) return value;
  const step = POINTER_TEXT_LIMIT / 2;
  const center = collapse(text.slice(0, at), Infinity).length;
  const start = Math.max(
    0,
    Math.min(Math.floor(center / step) * step - step / 2, value.length - POINTER_TEXT_LIMIT),
  );
  const end = start + POINTER_TEXT_LIMIT;
  const head = start > 0 ? "…" : "";
  const tail = end < value.length ? "…" : "";
  return head + value.slice(start + head.length, end - tail.length) + tail;
}

// The text a pointer at caret means within block: its source line in
// preformatted text, else the whole block when short, else the sentence
// under the pointer. A long paragraph's opening says little about "this".
// Overlong lines and sentences clip to the stretch around the pointer.
export function pointedText(block: Element, caret: Caret | null): string {
  const full = block.textContent ?? "";
  const whole = collapse(full);
  if (!caret || !block.contains(caret.node)) return whole;
  let at = caret.offset;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && node !== caret.node; node = walker.nextNode())
    at += (node as Text).length;
  if (block.closest("pre")) {
    const start = full.lastIndexOf("\n", at - 1) + 1;
    const end = full.indexOf("\n", at);
    return around(full.slice(start, end < 0 ? undefined : end), at - start) || whole;
  }
  if (whole.length < POINTER_TEXT_LIMIT) return whole;
  if (!Segmenter) return around(full, at);
  sentences ??= new Segmenter(undefined, { granularity: "sentence" });
  const sentence = sentences.segment(full).containing(at);
  return (sentence && around(sentence.segment, at - sentence.index)) || whole;
}

// Describe the element under the pointer (or clicked) from the DOM alone;
// caret, when known, is the character under the pointer.
export function describeNode(node: Node | null, caret: Caret | null = null): ReviewTarget | null {
  if (!node) return null;
  const labels = breadcrumb(node);
  const row = diffRow(node);
  if (row) {
    return {
      where: joinWhere(labels, `${row.side} ${row.line}`),
      file: row.file,
      side: row.side,
      line: row.line,
      text: collapse(diffRowText(row)),
    };
  }
  // Inside a diff but off its rows (padding, separators): the whole code
  // block's text says nothing about where the pointer is.
  if (node.getRootNode() instanceof ShadowRoot)
    return labels.length ? { where: joinWhere(labels) } : null;
  const control = composedClosest(node, "button,a,select,[role=option],[role=treeitem]");
  if (control) return { where: joinWhere(labels, `"${elementLabel(control)}"`) };
  // Text outside any block element still says what the pointer is on.
  const block =
    composedClosest(node, BLOCK_SELECTOR) ??
    (caret && composedContains(node, caret.node) ? caret.node.parentElement : null);
  if (!labels.length && !block) return null;
  const text = block ? pointedText(block, caret) : "";
  return text && text !== labels.at(-1)
    ? { where: joinWhere(labels), text }
    : { where: joinWhere(labels) };
}

// Drill through open shadow roots to the innermost element at a point.
export function elementAt(x: number, y: number): Element | null {
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === element) break;
    element = inner;
  }
  return element;
}

// The diffs' shadow roots, where tour code lives.
function shadowRoots(root: Element): ShadowRoot[] {
  return Array.from(root.querySelectorAll("diffs-container"))
    .map((element) => element.shadowRoot)
    .filter((shadow): shadow is ShadowRoot => !!shadow);
}

type ComposedSelection = Selection & {
  getComposedRanges?: (options: { shadowRoots: ShadowRoot[] }) => StaticRange[];
};
type ShadowSelectionRoot = ShadowRoot & { getSelection?: () => Selection | null };

// The DOM selection within root, including selections inside diff shadow
// roots. Returns null when nothing (non-whitespace) is selected there.
export function describeSelection(root: Element): ReviewTarget | null {
  // Chrome retargets a selection inside a shadow root to its host, so the
  // document selection looks collapsed even when text is selected.
  const selection = window.getSelection() as ComposedSelection | null;
  if (!selection || selection.rangeCount === 0) return null;
  const roots = shadowRoots(root);
  let text = selection.toString();
  let start: Node | null = selection.anchorNode;
  let end: Node | null = selection.focusNode;
  // Safari 17–18.1 shipped a variadic getComposedRanges that rejects this
  // form; the anchor and focus nodes then stand in.
  try {
    const [range] = selection.getComposedRanges?.({ shadowRoots: roots }) ?? [];
    if (range) {
      start = range.startContainer;
      end = range.endContainer;
    }
  } catch {
    // Keep anchorNode/focusNode.
  }
  if (!text.trim()) {
    for (const shadow of roots as ShadowSelectionRoot[]) {
      const inner = shadow.getSelection?.();
      if (inner && !inner.isCollapsed && inner.toString().trim()) {
        text = inner.toString();
        start = inner.anchorNode;
        end = inner.focusNode;
        break;
      }
    }
  }
  if (!text.trim() || !composedContains(root, start)) return null;
  const clipped = clipSelection(text);
  const labels = breadcrumb(start);
  const first = diffRow(start);
  const last = diffRow(end);
  if (first) {
    const lines =
      last && last.side === first.side && last.file === first.file
        ? [Math.min(first.line, last.line), Math.max(first.line, last.line)]
        : [first.line, first.line];
    const span = lines[0] === lines[1] ? `${lines[0]}` : `${lines[0]}–${lines[1]}`;
    return {
      where: joinWhere(labels, `${first.side} ${span}`),
      file: first.file,
      side: first.side,
      line: lines[0],
      end_line: lines[1],
      text: clipped,
    };
  }
  return { where: joinWhere(labels), text: clipped };
}

function intersectsViewport(rect: DOMRect, top: number, bottom: number): boolean {
  return rect.bottom > top && rect.top < bottom && rect.height > 0;
}

// First/last row of a code column that intersects [top, bottom].
function visibleRowSpan(rows: Element[], top: number, bottom: number): [number, number] | null {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rows[mid].getBoundingClientRect().bottom <= top) low = mid + 1;
    else high = mid;
  }
  let last = -1;
  for (let index = low; index < rows.length; index++) {
    if (rows[index].getBoundingClientRect().top >= bottom) break;
    last = index;
  }
  if (last < low) return null;
  const lineOf = (row: Element) => Number(row.getAttribute("data-line"));
  return [lineOf(rows[low]), lineOf(rows[last])];
}

function visibleDiffLines(item: Element, top: number, bottom: number): string {
  const spans: string[] = [];
  for (const host of item.querySelectorAll("diffs-container")) {
    for (const code of host.shadowRoot?.querySelectorAll("code") ?? []) {
      const rows = Array.from(code.querySelectorAll("[data-line]"));
      // Split columns hold one side; a unified column interleaves both.
      const sides: Array<[ReviewSide, Element[]]> = code.hasAttribute("data-deletions")
        ? [["old", rows]]
        : code.hasAttribute("data-additions")
          ? [["new", rows]]
          : [
              [
                "new",
                rows.filter((row) => row.getAttribute("data-line-type") !== "change-deletion"),
              ],
              [
                "old",
                rows.filter((row) => row.getAttribute("data-line-type") === "change-deletion"),
              ],
            ];
      for (const [side, sideRows] of sides) {
        const span = visibleRowSpan(sideRows, top, bottom);
        if (span) spans.push(`${side} ${span[0] === span[1] ? span[0] : `${span[0]}–${span[1]}`}`);
      }
    }
  }
  return spans.join(", ");
}

// Labels of the `[data-review-item]` regions intersecting the viewport of
// root, with visible diff line ranges appended. A region is left out when a
// visible region inside it (whose label extends its label) already names it,
// and a leading crumb shared by every region (e.g. "Tour") is dropped.
export function describeOnScreen(root: Element): string[] {
  const bounds = root.getBoundingClientRect();
  const top = Math.max(bounds.top, 0);
  const bottom = Math.min(bounds.bottom, window.innerHeight);
  const skip = breadcrumb(root).length;
  const visible: Array<{ crumbs: string[]; lines: string }> = [];
  for (const item of root.querySelectorAll<HTMLElement>("[data-review-item]")) {
    if (!intersectsViewport(item.getBoundingClientRect(), top, bottom)) continue;
    visible.push({
      crumbs: breadcrumb(item).slice(skip),
      lines: visibleDiffLines(item, top, bottom),
    });
  }
  const labels = visible.map(({ crumbs }) => crumbs.join(" › "));
  const first = visible[0]?.crumbs[0];
  const shared = visible.every(({ crumbs }) => crumbs.length > 1 && crumbs[0] === first) ? 1 : 0;
  return visible
    .filter((_, index) => !labels.some((other) => other.startsWith(`${labels[index]} › `)))
    .map(({ crumbs, lines }) => {
      const label = crumbs.slice(shared).join(" › ");
      return lines ? `${label} (${lines})` : label;
    });
}

function openDialogs(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], dialog[open]'))
    .filter((dialog) => dialog.getClientRects().length > 0)
    .map(
      (dialog) =>
        collapse(
          dialog.getAttribute("aria-label") ||
            dialog.querySelector("h1,h2,h3,[class*=header],[class*=title]")?.textContent,
          80,
        ) || "dialog",
    );
}

const targetKey = (target: ReviewTarget | null) =>
  target ? `${target.where}\u0000${target.text ?? ""}` : "";

export interface ReviewCapture {
  // Snapshots on-screen/selection/view immediately and ends capture.
  stop(): void;
  note(event: Omit<ReviewEvent, "ms">): void;
}

export function startReviewCapture(options: {
  root: HTMLElement;
  context: ReviewContext;
  t0: number;
  emit: (event: ReviewEvent) => void;
  onState: (state: ReviewCaptureState) => void;
}): ReviewCapture {
  const { root, context, t0, emit } = options;
  const state: ReviewCaptureState = {
    pointer: "",
    pointerText: "",
    selection: "",
    screen: "",
    view: "",
  };
  let viewKey = "";
  let screenKey = "";
  let pointerKey = "";
  let selectionKey = "";
  let dialogsKey = "[]";
  let pointerPoint: { x: number; y: number } | null = null;
  let pointerFrame: number | null = null;
  let screenTimer: number | null = null;
  let selectionTimer: number | null = null;
  let clickTimer: number | null = null;
  let stopped = false;
  // The state when recording starts is the state at audio t=0.
  let initial = true;
  let pointerDown: { x: number; y: number } | null = null;
  let lastClick = { key: "", ms: -Infinity };

  const now = () => (initial ? 0 : Math.max(0, Math.round(performance.now() - t0)));
  const record = (event: Omit<ReviewEvent, "ms">) => {
    if (!stopped) emit({ ms: now(), ...event } as ReviewEvent);
  };
  const publish = () => {
    if (!stopped) options.onState({ ...state });
  };

  function checkView() {
    const view = context.view();
    const key = JSON.stringify(view);
    if (key === viewKey) return;
    viewKey = key;
    state.view = view.where;
    record({ type: "view", ...view });
    publish();
  }

  function checkScreen() {
    const items = context.onScreen?.() ?? describeOnScreen(root);
    const key = JSON.stringify(items);
    if (key === screenKey) return;
    screenKey = key;
    state.screen = items[0] ?? "";
    publish();
    const scroller = root.querySelector<HTMLElement>("[data-review-scroll]");
    record({
      type: "on_screen",
      items,
      scroll_top: scroller ? Math.round(scroller.scrollTop) : undefined,
    });
  }

  function checkPointer() {
    pointerFrame = null;
    if (!pointerPoint) return;
    const { x, y } = pointerPoint;
    const element = elementAt(x, y);
    if (
      !element ||
      !composedContains(root, element) ||
      composedClosest(element, "[data-review-ignore]")
    ) {
      onPointerLeave();
      return;
    }
    const provided = context.pointAt?.(x, y, element);
    const target = provided === undefined ? describeNode(element, caretAt(x, y)) : provided;
    const key = targetKey(target);
    if (key === pointerKey) return;
    pointerKey = key;
    state.pointer = target?.where ?? "";
    state.pointerText = target?.text ?? "";
    record(target ? { type: "pointer", ...target } : { type: "pointer_leave" });
    publish();
  }

  function checkSelection() {
    selectionTimer = null;
    const provided = context.selection?.();
    const target = provided === undefined ? describeSelection(root) : provided;
    const key = targetKey(target);
    if (key === selectionKey) return;
    selectionKey = key;
    state.selection = target?.where ?? "";
    record(target ? { type: "selection", ...target } : { type: "selection", text: "" });
    publish();
  }

  function checkDialogs() {
    const dialogs = openDialogs();
    const key = JSON.stringify(dialogs);
    if (key === dialogsKey) return;
    const previous = JSON.parse(dialogsKey) as string[];
    for (const label of dialogs)
      if (!previous.includes(label)) record({ type: "dialog", where: label, open: true });
    for (const label of previous)
      if (!dialogs.includes(label)) record({ type: "dialog", where: label, open: false });
    dialogsKey = key;
  }

  const schedulePointer = () => {
    if (pointerFrame === null) pointerFrame = requestAnimationFrame(checkPointer);
  };
  const scheduleScreen = () => {
    if (screenTimer !== null) clearTimeout(screenTimer);
    screenTimer = window.setTimeout(() => {
      screenTimer = null;
      checkScreen();
    }, 250);
  };
  const scheduleSelection = () => {
    if (selectionTimer !== null) clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(checkSelection, 300);
  };

  const ignored = (event: Event) =>
    event
      .composedPath()
      .some((node) => node instanceof HTMLElement && node.hasAttribute("data-review-ignore"));
  const onPointerMove = (event: PointerEvent) => {
    pointerPoint = { x: event.clientX, y: event.clientY };
    schedulePointer();
  };
  const onPointerDown = (event: PointerEvent) => {
    pointerDown = { x: event.clientX, y: event.clientY };
    onPointerMove(event);
  };
  function onPointerLeave() {
    if (!pointerKey) return;
    record({ type: "pointer_leave" });
    pointerKey = "";
    state.pointer = "";
    state.pointerText = "";
    publish();
  }
  const onRootLeave = () => {
    pointerPoint = null;
    onPointerLeave();
  };
  const onClick = (event: MouseEvent) => {
    const element = event.composedPath()[0];
    // A drag ends in a click on the common ancestor; the selection says more.
    const dragged =
      pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5;
    pointerDown = null;
    if (!(element instanceof Element) || dragged || ignored(event)) return;
    const provided = context.pointAt?.(event.clientX, event.clientY, element);
    const target =
      provided === undefined
        ? describeNode(element, caretAt(event.clientX, event.clientY))
        : provided;
    const key = targetKey(target);
    const ms = now();
    // The second click of a double click adds nothing.
    if (target && !(key === lastClick.key && ms - lastClick.ms < 500)) {
      record({ type: "click", where: target.where, text: target.text });
    }
    lastClick = { key, ms };
    // Clicks usually change the view; check once the UI has reacted.
    if (clickTimer !== null) clearTimeout(clickTimer);
    clickTimer = window.setTimeout(() => {
      clickTimer = null;
      checkView();
      scheduleScreen();
    }, 50);
  };
  const onScroll = () => {
    scheduleScreen();
    schedulePointer();
  };
  const onVisibility = () =>
    record({ type: "page", state: document.hidden ? "hidden" : "visible" });
  const onBlur = () => record({ type: "page", state: "blur" });
  const onFocus = () => record({ type: "page", state: "focus" });

  root.addEventListener("pointermove", onPointerMove, { passive: true });
  root.addEventListener("pointerdown", onPointerDown, { passive: true });
  root.addEventListener("pointerleave", onRootLeave);
  root.addEventListener("click", onClick, true);
  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("selectionchange", scheduleSelection);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", scheduleScreen);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  // Backstop for changes without DOM events: Monaco selections and scrolls,
  // lazily rendered diffs, keyboard navigation, dialogs.
  const poll = window.setInterval(() => {
    checkView();
    checkScreen();
    checkSelection();
    checkDialogs();
    schedulePointer();
  }, 500);

  function detach() {
    stopped = true;
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointerleave", onRootLeave);
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("scroll", onScroll, true);
    document.removeEventListener("selectionchange", scheduleSelection);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("resize", scheduleScreen);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    window.clearInterval(poll);
    if (pointerFrame !== null) cancelAnimationFrame(pointerFrame);
    if (screenTimer !== null) clearTimeout(screenTimer);
    if (selectionTimer !== null) clearTimeout(selectionTimer);
    if (clickTimer !== null) clearTimeout(clickTimer);
  }

  try {
    checkView();
    checkScreen();
    checkSelection();
    checkDialogs();
  } catch (err) {
    detach();
    throw err;
  }
  initial = false;

  return {
    note: record,
    // Always detaches; a failing final snapshot is rethrown afterwards.
    stop() {
      if (stopped) return;
      try {
        checkView();
        checkScreen();
        checkSelection();
        record({ type: "stop" });
      } finally {
        detach();
      }
    },
  };
}
