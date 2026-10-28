import { highlightsByFile, orderByHighlights } from "./commitHighlights";

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

const paths = (files: { path: string }[]) => files.map((file) => file.path);

run("files follow the highlights order", () => {
  const files = [{ path: "a" }, { path: "b" }, { path: "c" }];
  assertEqual(paths(orderByHighlights(files, ["c", "a", "b"])), ["c", "a", "b"], "order");
});

run("unranked files keep their order after ranked ones", () => {
  const files = [{ path: "x" }, { path: "a" }, { path: "y" }, { path: "b" }];
  assertEqual(paths(orderByHighlights(files, ["b", "gone", "a"])), ["b", "a", "x", "y"], "order");
});

run("highlights group by file in line order", () => {
  const byFile = highlightsByFile({
    version: 1,
    files: ["a", "b"],
    highlights: [
      { file: "a", line: 9, comment: "late" },
      { file: "b", line: 1, comment: "other" },
      { file: "a", line: 2, comment: "early" },
    ],
  });
  assertEqual(
    byFile.get("a")?.map((h) => h.comment),
    ["early", "late"],
    "a",
  );
  assertEqual(byFile.get("b")?.length, 1, "b");
  assertEqual(highlightsByFile(null).size, 0, "none");
});
