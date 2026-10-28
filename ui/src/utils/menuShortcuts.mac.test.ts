import { strict as assert } from "node:assert";

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { platform: "MacIntel" },
});

function ev(part: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: "BracketLeft",
    key: "`",
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    ...part,
  } as KeyboardEvent;
}

try {
  const { isMac, matchChatInterfaceAction, menuShortcutLabel } = await import("./menuShortcuts");
  assert.equal(isMac, true);
  assert.equal(matchChatInterfaceAction(ev({})), "terminal", "Control+Shift+@ on Mac JIS");
  assert.equal(
    matchChatInterfaceAction(ev({ code: "Backquote", shiftKey: false })),
    "terminal",
    "original Control+backtick binding",
  );
  assert.equal(matchChatInterfaceAction(ev({ ctrlKey: false })), null, "typing backtick");
  assert.equal(
    matchChatInterfaceAction(ev({ ctrlKey: false, metaKey: true })),
    null,
    "Command is not Control",
  );
  assert.equal(matchChatInterfaceAction(ev({ metaKey: true })), null, "extra Command");
  assert.equal(matchChatInterfaceAction(ev({ altKey: true })), null, "extra Option");
  assert.equal(
    matchChatInterfaceAction(ev({ key: "@", shiftKey: false })),
    null,
    "Control+@ without Shift",
  );
  assert.equal(
    matchChatInterfaceAction(ev({ key: "{" })),
    null,
    "Control+Shift+[ on a US layout is not the JIS alias",
  );
  assert.equal(
    matchChatInterfaceAction(ev({ code: "KeyD", key: "D", ctrlKey: false, metaKey: true })),
    "diffs",
    "other Mac menu shortcuts are unchanged",
  );
  assert.equal(menuShortcutLabel("terminal"), "⌃` / ⌃⇧@ (JIS)");
  assert.equal(menuShortcutLabel("diffs"), "⌘⇧D");
  console.log("✓ menuShortcuts.mac: 12 assertions passed");
} finally {
  if (navigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "navigator");
  }
}
