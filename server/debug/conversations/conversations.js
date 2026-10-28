// Lists conversations and downloads each one's per-message token usage as CSV.

const list = document.getElementById("list");
const filter = document.getElementById("filter");
const errorEl = document.getElementById("error");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

function cell(className, text) {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text;
  return td;
}

async function downloadCSV(conv, slug) {
  // Drafts have no messages, and the API omits the empty list.
  const { messages = [] } = await getJSON(`/api/conversation/${conv.conversation_id}`);
  const rows = ["input_tokens,cache_write_tokens,cache_read_tokens,output_tokens"];
  for (const m of messages) {
    if (m.type !== "agent" || !m.usage_data) continue;
    const u = JSON.parse(m.usage_data);
    const cols = [
      u.input_tokens,
      u.cache_creation_input_tokens,
      u.cache_read_input_tokens,
      u.output_tokens,
    ];
    rows.push(cols.map((n) => n || 0).join(","));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = `${slug}-tokens.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function row(conv) {
  const slug = conv.slug || conv.conversation_id;
  const button = document.createElement("button");
  button.className = "btn btn-secondary btn-sm";
  button.type = "button";
  button.textContent = "Download CSV";
  button.onclick = () => downloadCSV(conv, slug).catch((e) => showError(`${slug}: ${e.message}`));
  const action = cell("", "");
  action.append(button);
  const tr = document.createElement("tr");
  tr.dataset.slug = slug.toLowerCase();
  tr.append(cell("slug", slug), cell("date", new Date(conv.created_at).toLocaleString()), action);
  return tr;
}

function applyFilter() {
  const q = filter.value.toLowerCase();
  for (const tr of list.rows) tr.hidden = !tr.dataset.slug.includes(q);
}
filter.addEventListener("input", applyFilter);

getJSON("/api/conversations").then(
  (convs) => {
    list.replaceChildren(...convs.map(row));
    applyFilter();
  },
  (e) => showError(e.message),
);
