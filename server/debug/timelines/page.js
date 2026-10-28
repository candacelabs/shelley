(() => {
  const $ = selector => document.querySelector(selector), status = $('#status'), list = $('#conversations'), view = $('#view');
  let conversations = [], serial = 0;
  async function json(url) {
    const r = await fetch(url);
    if (!r.ok) throw Error(`${r.status}: ${await r.text()}`);
    return r.json();
  }
  const parse = value => value ? JSON.parse(value) : null;
  const seconds = (start, end) => start && end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 1000) : null;
  function sidebar(open) {
    document.body.classList.toggle('sidebar-open',open);
    $('#sidebar-open').setAttribute('aria-expanded',String(open));
    if (!open) $('#sidebar-open').focus({preventScroll:true});
  }
  $('#sidebar-open').addEventListener('click',()=>sidebar(true));
  $('#sidebar-close').addEventListener('click',()=>sidebar(false));
  $('#sidebar-backdrop').addEventListener('click',()=>sidebar(false));
  list.addEventListener('click',e=>{
    if(document.body.classList.contains('sidebar-open')&&e.target.closest('.chat-row'))sidebar(false);
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&document.body.classList.contains('sidebar-open'))sidebar(false);
  });

  function toolCategory(name, input) {
    const tool = name.toLowerCase(), command = JSON.stringify(input).slice(0, 1000).toLowerCase();
    if (tool.includes('subagent')) return 'delegate';
    if (/message_parent|send_message|wait/.test(tool)) return 'message';
    if (tool.includes('browser')) return 'browser';
    if (/search/.test(tool) || /\b(rg|grep) /.test(command)) return 'search';
    if (/apply_patch|patch|edit|write_file/.test(tool)) return 'edit';
    if (/go test|pytest|unittest|vitest|playwright test|npm test|pnpm test|bun test/.test(command)) return 'test';
    if (/go build|make |npm install|pnpm install|tsc|go vet/.test(command)) return 'build';
    if (/sed -i|tee |cat >|cat <</.test(command)) return 'edit';
    if (/cat |sed -n|find |ls|head |tail |pwd|wc |git diff|git show|git status|git log/.test(command) || tool.includes('read')) return 'read';
    return 'command';
  }

  // One lane per conversation: its LLM calls (for cost) and its activity
  // events (for drawing), where a tool absorbs the reply-less call that issued it.
  function laneFrom({conversation: c, messages}) {
    messages = (messages || []).filter(m => !m.forked_from_message_id);
    const name = c.slug || c.conversation_id, raw = [], uses = new Map();
    for (const m of messages)
      for (const b of parse(m.llm_data)?.Content || [])
        if (b.Type === 5) uses.set(b.ID, {name: b.ToolName, input: b.ToolInput, request_id: m.message_id, model: m.model_name});
    function call(m, u, id, purpose, content = []) {
      const usage = {
        input_tokens: u.input_tokens || 0,
        cache_read_input_tokens: u.cache_read_input_tokens || 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
        output_tokens: u.output_tokens || 0,
        cost_usd: u.cost_usd || 0,
      };
      const tokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens;
      const model = u.model || m.model_name, start = u.start_time || null, end = u.end_time || null;
      if (!model && !tokens) return;
      raw.push({
        id, kind: 'llm', label: purpose === 'compaction' ? 'Compaction' : model || 'LLM', model: model || 'unknown',
        url: u.url || m.llm_api_url || '', purpose, start, end, at: m.created_at, seconds: seconds(start, end), usage, tokens,
        category: purpose === 'compaction' ? 'compaction' : content.some(b => b.Type === 2 && b.Text) ? 'chat' : 'thinking',
        has_reply_text: content.some(b => [2, 3].includes(b.Type) && (b.Text || b.Thinking)),
      });
    }
    for (const m of messages) {
      const content = parse(m.llm_data)?.Content || [], usage = parse(m.usage_data);
      if (m.type === 'agent' && usage) call(m, usage, m.message_id, null, content);
      (parse(m.other_usage_data) || []).forEach((u, i) => call(m, u, `${m.message_id}:indirect:${i}`, u.purpose));
      for (const b of content) {
        const use = b.Type === 6 && uses.get(b.ToolUseID);
        if (!use) continue;
        const start = b.ToolUseStartTime || null, end = b.ToolUseEndTime || null;
        const compaction = use.name === 'compact_in_place' && use.input?.action === 'compact';
        raw.push({
          id: `${m.message_id}:${b.ToolUseID}`, kind: 'tool', label: use.name, model: use.model, request_id: use.request_id,
          purpose: compaction ? 'compaction' : null, start, end, at: m.created_at, seconds: seconds(start, end),
          error: !!b.ToolError, input: use.input, category: compaction ? 'compaction' : toolCategory(use.name, use.input),
        });
      }
    }
    const calls = raw.filter(e => e.kind === 'llm'), requests = new Map(calls.map(e => [e.id, e])), merged = new Set();
    const events = raw.map(e => {
      const r = requests.get(e.request_id);
      if (!r || r.has_reply_text || merged.has(r.id) || !r.start || e.seconds == null || !(Date.parse(r.start) <= Date.parse(e.start))) return e;
      merged.add(r.id);
      return {...e, start: r.start, seconds: (Date.parse(e.end) - Date.parse(r.start)) / 1000, tool_seconds: e.seconds, request_seconds: r.seconds};
    }).filter(e => !merged.has(e.id)).map(e => {
      const begin = Date.parse(e.start || e.at), end = Date.parse(e.end);
      const timed = e.seconds != null && Number.isFinite(end) && end >= begin;
      return {...e, begin, finish: timed ? end : begin, timed, actor: name};
    }).filter(e => Number.isFinite(e.begin)).sort((a, b) => a.begin - b.begin);
    return {id: c.conversation_id, name, main: c.user_initiated, model: c.model, messages, calls, events};
  }

  async function loadTree(id) {
    const [response, children] = await Promise.all([
      json(`/api/conversation/${encodeURIComponent(id)}`),
      json(`/api/conversation/${encodeURIComponent(id)}/subagents`),
    ]);
    const nested = await Promise.all(children.map(child => loadTree(child.conversation_id)));
    return [laneFrom(response), ...nested.flat()];
  }

  async function load() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id) return;
    const ticket = ++serial;
    markSelection();
    $('#chat-title').textContent = conversations.find(c=>c.conversation_id===id)?.slug || id;
    status.classList.remove('error');
    status.textContent = 'Loading conversation and helpers…';
    TimelineGraphs.unmount();
    view.replaceChildren();
    $('#refresh').disabled = true;

    try {
      const lanes = await loadTree(id);
      if (ticket !== serial) return;
      ShelleyTimeline.render(view, lanes);
      status.textContent = '';
    } catch (e) {
      if (ticket === serial) { status.textContent = e.message; status.classList.add('error'); }
    } finally {
      if (ticket === serial) $('#refresh').disabled = false;
    }
  }

  function markSelection() {
    list.querySelectorAll('.chat-row').forEach(row=>
      row.setAttribute('aria-current',row.hash===location.hash?'true':'false'));
  }

  function populate() {
    const q = $('#filter').value.toLowerCase();
    const matches = conversations.filter(c => (c.slug || c.conversation_id).toLowerCase().includes(q));
    $('#chat-count').textContent = q ? `${matches.length} of ${conversations.length} chats` : `${matches.length} chats`;
    list.replaceChildren(...matches.map(c=>{
      const row = document.createElement('a'), name = document.createElement('span'), meta = document.createElement('span');
      row.className = 'chat-row';
      row.href = `#${c.conversation_id}`;
      name.className = 'chat-name';
      name.textContent = c.slug || c.conversation_id;
      meta.className = 'chat-meta';
      meta.textContent = [new Date(c.updated_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}),c.archived?'Archived':'',c.model].filter(Boolean).join(' · ');
      row.append(name,meta);
      return row;
    }));
    if (!matches.length) list.textContent = 'No matching chats.';
    markSelection();
  }
  $('#filter').addEventListener('input', populate);
  window.addEventListener('hashchange', load);
  $('#refresh').addEventListener('click', load);
  Promise.all([json('/api/conversations'), json('/api/conversations/archived')]).then(([active, archived]) => {
    const roots = [...active, ...archived].filter(c => c.user_initiated && !c.is_draft);
    conversations = [...new Map(roots.map(c => [c.conversation_id, c])).values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    populate();
    if (!location.hash && conversations.length) history.replaceState(null,'',`#${conversations[0].conversation_id}`);
    load();

  }).catch(e => status.textContent = e.message);
})();
