import assert from "node:assert/strict";
import { test } from "node:test";
import { pathShortener } from "./shortenPaths";

const shortenPaths = (paths: string[], fits: (label: string) => boolean) =>
  pathShortener(paths)(fits);

const paths = [
  "db/db.go",
  "ui/src/features/git/history/components/commit-details/DiffstatList.vue",
  "ui/src/features/projects/exports/components/commit-details/DiffstatList.vue",
  "server/integrations/github/webhooks/notifications/dispatcher.go",
  "server/integrations/slack/webhooks/notifications/dispatcher.go",
  "server/notifications/dispatcher.go",
];

test("keeps paths that fit and shortens the middle of long paths", () => {
  const labels = shortenPaths(paths, (path) => path.length <= 36);
  assert.deepEqual(
    [...labels.values()],
    [
      "db/db.go",
      "ui/…/history/…/DiffstatList.vue",
      "ui/…/exports/…/DiffstatList.vue",
      "server/…/github/…/dispatcher.go",
      "server/…/slack/…/dispatcher.go",
      "server/notifications/dispatcher.go",
    ],
  );
});

test("adds back parent folders while the label still fits", () => {
  const path = "ui/src/features/git/history/components/commit-details/DiffstatList.vue";
  assert.equal(
    shortenPaths([path], (label) => label.length <= 40).get(path),
    "ui/…/commit-details/DiffstatList.vue",
  );
  assert.equal(
    shortenPaths([path], (label) => label.length <= 55).get(path),
    "ui/…/history/components/commit-details/DiffstatList.vue",
  );
});

test("uses the available width instead of a fixed path length", () => {
  assert.deepEqual([...shortenPaths(paths, () => true).values()], paths);
  assert.equal(
    shortenPaths(["server/notifications/dispatcher.go"], (path) => path.length <= 25).get(
      "server/notifications/dispatcher.go",
    ),
    "server/…/dispatcher.go",
  );
});

test("one prepared shortener serves every width", () => {
  const shorten = pathShortener(paths);
  assert.equal(shorten(() => true).get(paths[3]), paths[3]);
  assert.equal(shorten(() => false).get(paths[3]), "server/…/github/…/dispatcher.go");
});

test("retains enough context when shortened labels collide", () => {
  const siblings = ["one", "two"].flatMap((a) =>
    ["red", "blue"].flatMap((b) => ["left", "right"].map((c) => `root/${a}/${b}/${c}/worker.ts`)),
  );
  const labels = [...shortenPaths(siblings, () => false).values()];
  assert.equal(new Set(labels).size, siblings.length);
  for (const label of labels) assert.ok(label.endsWith("/worker.ts"));
});

test("never shortens the filename, even if it cannot fit", () => {
  const filename = `${"a_long_filename_".repeat(8)}test.ts`;
  const path = `src/generated/deeply/nested/${filename}`;
  assert.equal(shortenPaths([path], () => false).get(path), `src/…/${filename}`);
  assert.equal(shortenPaths([filename], () => false).get(filename), filename);
});

test("never makes a label longer than the original path", () => {
  assert.equal(shortenPaths(["a/b/c.go"], () => false).get("a/b/c.go"), "a/b/c.go");
});

test("keeps a root file distinct from a nested file with the same name", () => {
  const labels = [...shortenPaths(["worker.ts", "src/lib/worker.ts"], () => false).values()];
  assert.deepEqual(labels, ["worker.ts", "src/lib/worker.ts"]);
});

test("handles an empty file list", () => {
  assert.equal(shortenPaths([], () => false).size, 0);
});
