import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightSearchMatches } from "./searchHighlight";

test("highlights every literal match while preserving case and surrounding text", () => {
  assert.deepEqual(highlightSearchMatches("my-Pelican-pelican-notes", "PELICAN"), [
    { text: "my-", mark: false },
    { text: "Pelican", mark: true },
    { text: "-", mark: false },
    { text: "pelican", mark: true },
    { text: "-notes", mark: false },
  ]);
});

test("leaves empty queries and unmatched text alone", () => {
  for (const query of ["", " ", "missing"]) {
    assert.deepEqual(highlightSearchMatches("pelican", query), [{ text: "pelican", mark: false }]);
  }
  assert.deepEqual(highlightSearchMatches("", "pelican"), [{ text: "", mark: false }]);
});

test("highlights whole names and adjacent matches without empty segments", () => {
  assert.deepEqual(highlightSearchMatches("pelican", "pelican"), [{ text: "pelican", mark: true }]);
  assert.deepEqual(highlightSearchMatches("aaaa", "aa"), [
    { text: "aa", mark: true },
    { text: "aa", mark: true },
  ]);
});

test("treats regex syntax and SQL wildcards literally", () => {
  const query = "[a]+.*?^${}()|\\%_";
  assert.deepEqual(highlightSearchMatches(`before-${query}-after`, query), [
    { text: "before-", mark: false },
    { text: query, mark: true },
    { text: "-after", mark: false },
  ]);
});

test("preserves Unicode and HTML-like text as plain segments", () => {
  assert.deepEqual(highlightSearchMatches("İ🙂<b>pelican</b>", "PELICAN"), [
    { text: "İ🙂<b>", mark: false },
    { text: "pelican", mark: true },
    { text: "</b>", mark: false },
  ]);
});
