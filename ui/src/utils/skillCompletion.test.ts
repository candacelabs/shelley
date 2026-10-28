import assert from "node:assert/strict";
import { test } from "node:test";
import { filterSkills, removeSkillToken, skillTokenAt } from "./skillCompletion";

const foo = { name: "foo", description: "Make diagrams", activate: "shelley skill cat foo" };

test("/skills is a command only at the start of the draft, with its query up to the caret", () => {
  assert.deepEqual(skillTokenAt("/skills", 7), { start: 0, end: 7, query: "" });
  assert.deepEqual(skillTokenAt("/skills Make diagrams then", 21), {
    start: 0,
    end: 21,
    query: "Make diagrams",
  });
  assert.deepEqual(skillTokenAt("/skills foo\nnext", 11), { start: 0, end: 11, query: "foo" });
});

test("mid-draft mentions, partial commands, selections and later lines are not tokens", () => {
  for (const text of [
    "Please /skills foo",
    "one\n/skills foo",
    " /skills",
    "/skill",
    "/skillsx",
    "`/skills`",
    "/skills\nnext",
  ]) {
    assert.equal(skillTokenAt(text, text.length), null, text);
  }
  assert.equal(skillTokenAt("/skills", 7, 0), null);
  assert.equal(skillTokenAt("/skills", 3), null);
  assert.equal(skillTokenAt("/skills", 8), null);
});

test("filtering is case-insensitive across name and description only", () => {
  const web = {
    name: "web",
    description: "Search online",
    activate: "foo",
    source_path: "diagrams",
  };
  assert.deepEqual(filterSkills([foo, web], "FOO DIAGRAMS"), [foo]);
  assert.deepEqual(filterSkills([foo, web], "online"), [web]);
  assert.deepEqual(filterSkills([foo, web], "  "), [foo, web]);
  assert.deepEqual(filterSkills([foo, web], "unknown"), []);
});

test("removeSkillToken drops the command and its line break, keeping the rest", () => {
  const token = (text: string) =>
    skillTokenAt(text, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n"))!;
  assert.deepEqual(removeSkillToken("/skills foo", token("/skills foo")), { text: "", cursor: 0 });
  assert.deepEqual(
    removeSkillToken("/skills foo\nrest of draft", token("/skills foo\nrest of draft")),
    {
      text: "rest of draft",
      cursor: 0,
    },
  );
});
