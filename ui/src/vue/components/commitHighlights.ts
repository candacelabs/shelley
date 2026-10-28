// Commit highlights in the diff viewer: an agent-chosen file order and short
// comments pinned to lines (see CommitHighlights).
import type * as Monaco from "monaco-editor";
import type { CommitHighlight, CommitHighlights } from "../../types";

// Orders files most important first. Files the order omits keep their
// relative order after the ranked ones.
export function orderByHighlights<T extends { path: string }>(files: T[], order: string[]): T[] {
  const rank = new Map(order.map((path, index) => [path, index]));
  return files
    .map((file, index) => ({ file, rank: rank.get(file.path) ?? order.length + index }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ file }) => file);
}

// Groups highlights by file, each file's in line order.
export function highlightsByFile(
  highlights: CommitHighlights | null,
): Map<string, CommitHighlight[]> {
  const byFile = new Map<string, CommitHighlight[]>();
  for (const highlight of highlights?.highlights ?? []) {
    const list = byFile.get(highlight.file) ?? [];
    list.push(highlight);
    byFile.set(highlight.file, list);
  }
  for (const list of byFile.values()) list.sort((a, b) => a.line - b.line);
  return byFile;
}

let nextHighlightSet = 0;

// Marks each highlighted line in editor and shows its comment in a callout
// beneath it, with a button that calls onComment to answer the highlight.
// Returns a function that removes them.
export function showHighlights(
  monaco: typeof Monaco,
  editor: Monaco.editor.ICodeEditor,
  highlights: CommitHighlight[],
  onComment: (highlight: CommitHighlight) => void,
): () => void {
  const decorations = editor.createDecorationsCollection(
    highlights.map((highlight) => ({
      range: new monaco.Range(highlight.line, 1, highlight.line, 1),
      options: {
        isWholeLine: true,
        className: "diff-highlight-line",
        linesDecorationsClassName: "diff-highlight-gutter",
        overviewRuler: {
          color: "rgba(217, 119, 6, 0.9)",
          position: monaco.editor.OverviewRulerLane.Center,
        },
      },
    })),
  );

  // Monaco hides view zones from screen readers and claims their clicks
  // and touches, so a zone only reserves the space beneath the line; the
  // callout itself is an overlay widget kept on top of it.
  const set = nextHighlightSet++;
  const entries = highlights.map((highlight, i) => {
    const domNode = document.createElement("div");
    domNode.className = "diff-highlight-zone";
    domNode.style.transform = "translateY(-100000px)";
    // Tabbing to an off-screen callout's button scrolls its line into view.
    const reveal = () => {
      const last = editor.getModel()?.getLineCount() ?? highlight.line;
      editor.revealLinesInCenterIfOutsideViewport(
        highlight.line,
        Math.min(highlight.line + 1, last),
      );
    };
    domNode.append(callout(highlight.comment, () => onComment(highlight), reveal));
    const widget: Monaco.editor.IOverlayWidget = {
      getId: () => `shelley.highlight.${set}.${i}`,
      getDomNode: () => domNode,
      getPosition: () => null,
    };
    const zone: Monaco.editor.IViewZone = {
      afterLineNumber: highlight.line,
      // Hug the line, ahead of the diff's own zones (deleted lines,
      // alignment padding), which default to 10000.
      ordinal: 9999,
      heightInPx: 0,
      domNode: document.createElement("div"),
      // Monaco owns the widget's top, so the zone's position is a transform.
      onDomNodeTop: (top) => (domNode.style.transform = `translateY(${top}px)`),
    };
    return { id: "", zone, widget, domNode };
  });
  // Callouts wrap to the text area's width; each zone takes its callout's
  // height, re-measured whenever that changes (width, fonts, zoom).
  const fit = (accessor: Monaco.editor.IViewZoneChangeAccessor) => {
    const info = editor.getLayoutInfo();
    for (const entry of entries) {
      entry.domNode.style.left = `${info.contentLeft}px`;
      entry.domNode.style.width = `${info.contentWidth - info.verticalScrollbarWidth}px`;
      const height = entry.domNode.offsetHeight;
      if (height === entry.zone.heightInPx) continue;
      entry.zone.heightInPx = height;
      if (entry.id) accessor.layoutZone(entry.id);
    }
  };
  for (const entry of entries) editor.addOverlayWidget(entry.widget);
  editor.changeViewZones((accessor) => {
    fit(accessor);
    for (const entry of entries) entry.id = accessor.addZone(entry.zone);
  });
  const layout = editor.onDidLayoutChange(() => editor.changeViewZones(fit));
  const resize = new ResizeObserver(() => editor.changeViewZones(fit));
  for (const entry of entries) resize.observe(entry.domNode);

  return () => {
    layout.dispose();
    resize.disconnect();
    decorations.clear();
    editor.changeViewZones((accessor) => {
      for (const entry of entries) accessor.removeZone(entry.id);
    });
    for (const entry of entries) editor.removeOverlayWidget(entry.widget);
  };
}

const COMMENT_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

function callout(comment: string, onComment: () => void, onKeyboardFocus: () => void) {
  const element = document.createElement("div");
  element.className = "diff-highlight-callout";
  element.setAttribute("role", "note");
  const text = document.createElement("span");
  text.className = "diff-highlight-callout-text";
  text.textContent = comment;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "diff-highlight-callout-comment";
  button.setAttribute("aria-label", "Comment");
  button.title = "Comment on this highlight";
  button.innerHTML = COMMENT_ICON;
  button.addEventListener("click", onComment);
  button.addEventListener("focus", () => {
    if (button.matches(":focus-visible")) onKeyboardFocus();
  });
  element.append(text, button);
  return element;
}
