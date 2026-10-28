// /debug/channels/: play the phone on in-memory chats bound to conversations.
"use strict";

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false && kid !== "") el.append(kid);
  }
  return el;
}

const REFUSALS = [
  "",
  "opted_out",
  "no_chat",
  "line_paused",
  "chat_critical",
  "rate_limited",
  "unanswered",
];

const state = {
  chats: [], // from GET /api/debug/channels
  fresh: new Set(), // chats made with "New chat" that the server hasn't seen yet
  selected: "",
  rendered: "", // key of what the stream shows; skip re-rendering when unchanged
  error: "",
};

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res;
}

function chatPath(id, action) {
  return `/api/debug/channels/${encodeURIComponent(id)}/${action}`;
}

function currentChat() {
  return (
    state.chats.find((c) => c.chat_id === state.selected) ||
    (state.selected ? { chat_id: state.selected, events: [], refuse: "", unanswered: 0 } : null)
  );
}

// ---- list ----

function renderList() {
  const ids = new Set(state.chats.map((c) => c.chat_id));
  for (const id of state.fresh) if (ids.has(id)) state.fresh.delete(id);
  const rows = [...state.fresh]
    .map((id) => ({ chat_id: id, events: [] }))
    .concat([...state.chats].sort((a, b) => lastSeq(b) - lastSeq(a)));
  if (!rows.length) {
    $("#list").replaceChildren(
      h("p", { class: "none muted" }, "No chats yet. Start one with New chat."),
    );
    return;
  }
  $("#list").replaceChildren(
    ...rows.map((c) => {
      const last = c.events.filter((e) => e.kind === "in" || e.kind === "out").at(-1);
      return h(
        "a",
        {
          class: "row" + (c.chat_id === state.selected ? " selected" : ""),
          href: `#${encodeURIComponent(c.chat_id)}`,
        },
        h("div", { class: "row-title" }, c.slug || c.chat_id),
        h(
          "div",
          { class: "row-sub" },
          last ? `${last.kind === "in" ? "You: " : ""}${last.text}` : "no messages",
        ),
      );
    }),
  );
}

function lastSeq(c) {
  return c.events.length ? c.events.at(-1).seq : 0;
}

// ---- chat ----

// renderChat builds the chat pane for the selection; refreshChat updates it.
function renderChat() {
  state.rendered = "";
  document.querySelector(".app").classList.toggle("show-chat", !!state.selected);
  if (!state.selected) {
    $("#chat").replaceChildren(
      h("div", { class: "empty muted" }, "Pick a chat, or start one with New chat."),
    );
    return;
  }
  const refuse = h(
    "select",
    { id: "refuse", onchange: (e) => setRefuse(e.target.value) },
    REFUSALS.map((code) => h("option", { value: code }, code || "none")),
  );
  $("#chat").replaceChildren(
    h(
      "header",
      { class: "chat-head" },
      h("a", { class: "btn back", href: "#" }, "← Chats"),
      h("span", { class: "chat-title" }, state.selected),
      h("span", { id: "conv-link" }),
      h(
        "label",
        { title: "Make the gateway refuse Shelley's calls like exed would" },
        "Refuse",
        refuse,
      ),
      h("span", { id: "unanswered", class: "muted" }),
    ),
    h("div", { id: "stream", class: "stream" }),
    h("div", { id: "errbox", class: "errbox", hidden: true }),
    composer("phone", "Text Shelley…", "Send", receive),
    composer(
      "as-shelley",
      "Reply as the conversation, through the channel's send path…",
      "Reply",
      sendAsShelley,
    ),
  );
  refreshChat();
  $("#phone").focus();
}

function composer(id, placeholder, label, action) {
  const ta = h("textarea", { id, rows: 1, placeholder });
  const submit = async () => {
    const text = ta.value;
    if (!text.trim()) return;
    ta.value = "";
    try {
      await action(text);
      showError("");
    } catch (err) {
      ta.value = text;
      showError(err.message);
    }
    tick();
  };
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  return h(
    "div",
    { class: `composer ${id}` },
    ta,
    h("button", { class: "btn", type: "button", onclick: submit }, label),
  );
}

function showError(msg) {
  state.error = msg;
  const box = $("#errbox");
  if (!box) return;
  box.hidden = !msg;
  box.textContent = msg;
}

function refreshChat() {
  const c = currentChat();
  if (!c) return;
  const link = $("#conv-link");
  const href = c.conversation_id ? `/c/${encodeURIComponent(c.slug || c.conversation_id)}` : "";
  if (link.dataset.href !== href) {
    link.dataset.href = href;
    link.replaceChildren(
      href
        ? h("a", { href, target: "_blank" }, "conversation ↗")
        : h("span", { class: "muted" }, "no conversation yet"),
    );
  }
  const refuse = $("#refuse");
  if (document.activeElement !== refuse) refuse.value = c.refuse || "";
  $("#unanswered").textContent = c.unanswered ? `${c.unanswered} unanswered` : "";

  const key = `${lastSeq(c)}:${c.events.length}:${c.typing}:${c.events.filter((e) => e.error).length}`;
  if (key === state.rendered) return;
  state.rendered = key;
  const stream = $("#stream");
  const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 40;
  const nodes = c.events.flatMap(renderEvent);
  if (c.typing) nodes.push(h("div", { class: "typing" }, "typing…"));
  stream.replaceChildren(...nodes.filter(Boolean));
  if (atBottom) stream.scrollTop = stream.scrollHeight;
}

function renderEvent(e) {
  switch (e.kind) {
    case "in":
    case "out":
      return [
        h(
          "div",
          { class: `bubble ${e.kind}${e.error ? " failed" : ""}`, title: e.message_id },
          e.text,
          e.media_url
            ? h("div", {}, h("a", { href: e.media_url, target: "_blank" }, e.media_url))
            : null,
        ),
        h("div", { class: `meta ${e.kind}` }, fmtTime(e.time)),
        e.error ? h("div", { class: "note err" }, `Not delivered: ${e.error}`) : null,
      ];
    case "react":
      return h("div", { class: "note" }, `Shelley reacted ${e.text} to ${e.message_id}`);
    case "read":
      return h("div", { class: "note" }, `Read ${fmtTime(e.time)}`);
    case "refused":
      return h(
        "div",
        { class: "note err" },
        `Gateway refused ${e.error}${e.text ? `: “${e.text}”` : ""}`,
      );
  }
  return null;
}

// ---- actions ----

async function receive(text) {
  await post(chatPath(state.selected, "receive"), { text });
}

async function sendAsShelley(text) {
  await post(chatPath(state.selected, "send"), { text });
}

async function setRefuse(code) {
  try {
    await post(chatPath(state.selected, "refuse"), { code });
    showError("");
  } catch (err) {
    showError(err.message);
  }
  tick();
}

function newChat() {
  const id = `debug-${Math.random().toString(36).slice(2, 8)}`;
  state.fresh.add(id);
  location.hash = encodeURIComponent(id);
}

// ---- loop ----

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const res = await fetch("/api/debug/channels");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.chats = await res.json();
    $("#offline").hidden = true;
    renderList();
    refreshChat();
  } catch {
    $("#offline").hidden = false;
  } finally {
    ticking = false;
  }
}

function selectFromHash() {
  state.selected = decodeURIComponent(location.hash.slice(1));
  renderList();
  renderChat();
}

$("#new-chat").addEventListener("click", newChat);
window.addEventListener("hashchange", selectFromHash);
selectFromHash();
tick();
setInterval(tick, 1000);
