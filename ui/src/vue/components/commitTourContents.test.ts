import type { GitTour } from "../../services/api";
import { buildTourContents, buildTourContentsLayout } from "./commitTourContents";

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function run(name: string, fn: () => void): void {
  fn();
  console.log(`✓ ${name}`);
}

const patch = (start: number, path = "src/example.ts") =>
  [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${start},1 +${start},1 @@`,
    "-old",
    "+new",
  ].join("\n");

run("tour contents follows narrative order with unique anchors", () => {
  const tour: GitTour = {
    version: 1,
    title: "Example tour",
    intro: "Start here.",
    chunks: [
      { header: "## Core behavior" },
      { patch: patch(2), comment: "First change." },
      { patch: patch(18), comment: "Second change." },
    ],
  };

  const contents = buildTourContents(tour, true);
  assertEqual(
    contents,
    [
      { anchor: "tour-overview", label: "Overview", kind: "overview" },
      { anchor: "tour-entry-0", label: "Core behavior", kind: "section" },
      {
        anchor: "tour-entry-1",
        label: "src/example.ts · 2–2 +1 −1",
        kind: "change",
        trivial: false,
        treePath: ["src", "example.ts"],
        decoration: "L2",
        decorationTitle: "2–2",
        additions: 1,
        deletions: 1,
      },
      {
        anchor: "tour-entry-2",
        label: "src/example.ts · 18–18 +1 −1",
        kind: "change",
        trivial: false,
        treePath: ["src", "example.ts"],
        decoration: "L18",
        decorationTitle: "18–18",
        additions: 1,
        deletions: 1,
      },
    ],
    "contents",
  );
  assertEqual(
    buildTourContentsLayout(contents).groups[0]?.rows.map((row) =>
      row.kind === "directory"
        ? `directory:${row.label}`
        : row.kind === "file"
          ? `file:${row.label}`
          : `change:${row.item.anchor}`,
    ),
    ["directory:src", "file:src/example.ts", "change:tour-entry-1", "change:tour-entry-2"],
    "same-directory rows",
  );
});

run("tour filename trees preserve narrative order and file extensions", () => {
  const items = buildTourContents(
    {
      version: 1,
      chunks: [
        { header: "## Ordered changes" },
        { patch: patch(2, "zeta/really-long-name.test.ts") },
        { patch: patch(4, "alpha/first.go") },
        { patch: patch(8, "zeta/again.ts") },
      ],
    },
    false,
  );
  const layout = buildTourContentsLayout(items);
  assertEqual(
    layout.groups[0]?.rows.map((row) =>
      row.kind === "directory"
        ? `directory:${row.label}`
        : row.kind === "file"
          ? `file:${row.filenameStem}|${row.filenameSuffix}|${row.anchor}`
          : `change:${row.item.anchor}`,
    ),
    [
      "directory:zeta",
      "file:really-long-name|.test.ts|tour-entry-1",
      "change:tour-entry-1",
      "directory:alpha",
      "file:first|.go|tour-entry-2",
      "change:tour-entry-2",
      "directory:zeta",
      "file:again|.ts|tour-entry-3",
      "change:tour-entry-3",
    ],
    "ordered rows",
  );
});

run("a tour without overview content starts at its first change", () => {
  const tour: GitTour = { version: 1, chunks: [{ patch: patch(7), trivial: true }] };
  assertEqual(
    buildTourContents(tour, false),
    [
      {
        anchor: "tour-entry-0",
        label: "src/example.ts · 7–7 +1 −1",
        kind: "change",
        trivial: true,
        treePath: ["src", "example.ts"],
        decoration: "L7",
        decorationTitle: "7–7",
        additions: 1,
        deletions: 1,
      },
    ],
    "contents",
  );
});

run("tour contents shows per-chunk counts for additions, deletions, and metadata changes", () => {
  const contents = buildTourContents(
    {
      version: 1,
      chunks: [
        {
          patch: ["--- /dev/null", "+++ b/added.ts", "@@ -0,0 +1,2 @@", "+first", "+second"].join(
            "\n",
          ),
        },
        {
          patch: ["--- a/deleted.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-first", "-second"].join(
            "\n",
          ),
        },
        {
          patch: ["diff --git a/script.sh b/script.sh", "old mode 100644", "new mode 100755"].join(
            "\n",
          ),
        },
      ],
    },
    false,
  );
  assertEqual(
    contents.map((item) => {
      if (item.kind !== "change") throw new Error("expected a change");
      return [item.label, item.decoration, item.additions, item.deletions];
    }),
    [
      ["added.ts · 1–2 +2", "L1–2", 2, 0],
      ["deleted.ts · 1–2 −2", "L1–2", 0, 2],
      ["script.sh", undefined, 0, 0],
    ],
    "change counts and compact labels",
  );
});

run("file grouping respects narrative boundaries and full paths", () => {
  const contents = buildTourContents(
    {
      version: 1,
      chunks: [
        { patch: patch(2, "first/example.ts") },
        { patch: patch(8, "first/example.ts"), trivial: true },
        { patch: patch(4, "second/example.ts") },
        { patch: patch(18, "first/example.ts") },
        { header: "## Next section" },
        { patch: patch(28, "first/example.ts") },
        { patch: patch(2, "root.ts") },
        { patch: patch(8, "root.ts") },
      ],
    },
    false,
  );
  assertEqual(
    buildTourContentsLayout(contents).groups.map((group) =>
      group.rows.map((row) =>
        row.kind === "directory"
          ? `directory:${row.label}`
          : row.kind === "file"
            ? `file:${row.label}:${row.depth}`
            : row.kind === "media"
              ? `media:${row.item.anchor}`
              : `change:${row.item.anchor}:${row.depth}`,
      ),
    ),
    [
      [
        "directory:first",
        "file:first/example.ts:1",
        "change:tour-entry-0:2",
        "change:tour-entry-1:2",
        "directory:second",
        "file:second/example.ts:1",
        "change:tour-entry-2:2",
        "directory:first",
        "file:first/example.ts:1",
        "change:tour-entry-3:2",
      ],
      [
        "directory:first",
        "file:first/example.ts:1",
        "change:tour-entry-5:2",
        "file:root.ts:0",
        "change:tour-entry-6:1",
        "change:tour-entry-7:1",
      ],
    ],
    "grouped narrative",
  );
});

run("decisions, questions, and media join the contents", () => {
  const tour: GitTour = {
    version: 1,
    decisions: [{ title: "Pin media in git" }],
    questions: [{ title: "Autoplay?" }, { title: "Keep the old screen?", body: "Context." }],
    chunks: [
      { patch: patch(2, "ui/view.ts") },
      { blob: "a".repeat(40), mime: "image/png", name: "after.png", comment: "After." },
      { patch: patch(8, "ui/view.ts") },
      { blob: "b".repeat(40), mime: "video/webm", name: "demo.webm" },
    ],
  };
  const contents = buildTourContents(tour, false);
  assertEqual(
    contents.filter((item) => item.kind === "overview" || item.kind === "media"),
    [
      { anchor: "tour-decisions", label: "Key design decisions", kind: "overview" },
      { anchor: "tour-questions", label: "Questions (2)", kind: "overview" },
      { anchor: "tour-entry-1", label: "after.png", kind: "media", video: false },
      { anchor: "tour-entry-3", label: "demo.webm", kind: "media", video: true },
    ],
    "front matter and media items",
  );
  const layout = buildTourContentsLayout(contents);
  assertEqual(
    layout.lead.map((item) => item.anchor),
    ["tour-decisions", "tour-questions"],
    "lead items",
  );
  assertEqual(
    layout.groups[0]?.rows.map((row) =>
      row.kind === "directory"
        ? `directory:${row.label}`
        : row.kind === "file"
          ? `file:${row.label}`
          : `${row.kind}:${row.item.anchor}`,
    ),
    [
      "directory:ui",
      "file:ui/view.ts",
      "change:tour-entry-0",
      "media:tour-entry-1",
      // Media interrupts the file tree, so the next change restates its file.
      "directory:ui",
      "file:ui/view.ts",
      "change:tour-entry-2",
      "media:tour-entry-3",
    ],
    "media rows",
  );
});
