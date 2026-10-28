// Mounts the normal chat TokenCostGraph on the debug timeline's clock.
import { createApp, h } from "vue";
import TokenCostGraph from "./components/TokenCostGraph.vue";

let app = null;

function unmount() {
  app?.unmount();
  app = null;
}

// x maps a timestamp (ms) to the timeline's 0..1 position; compactions are
// marker positions on that scale.
function mount(el, lanes, contextId, x, compactions, label) {
  const calls = lanes
    .flatMap((lane) => lane.calls)
    .sort((a, b) => Date.parse(a.end || a.at) - Date.parse(b.end || b.at));
  const entries = calls.map((call) => ({
    ...call.usage,
    model: call.model,
    url: call.url,
    timestamp: Date.parse(call.end || call.at),
    start_time: call.start,
    end_time: call.end,
    snippet: call.purpose || call.label,
  }));
  // One context point per agent message with usage, as contextCompositionPoints counts them.
  const { messages } = lanes.find((lane) => lane.id === contextId);
  const contextTimes = messages
    .filter((message) => message.type === "agent")
    .map((message) => ({
      message,
      usage: message.usage_data ? JSON.parse(message.usage_data) : null,
    }))
    .filter(
      ({ usage }) =>
        usage &&
        (usage.input_tokens || 0) +
          (usage.cache_read_input_tokens || 0) +
          (usage.cache_creation_input_tokens || 0) +
          (usage.output_tokens || 0) >
          0,
    )
    .map(({ message, usage }) => Date.parse(usage.end_time || message.created_at));
  const layout = (times) => ({
    xs: times.map(x),
    turns: times.length ? [[0, times.length - 1]] : [],
    activeMs: 0, // unused: the timeline supplies its own axis label
  });
  app = createApp({
    render: () =>
      h(TokenCostGraph, {
        entries,
        messages,
        models: [],
        panes: ["context", "cumulative"],
        timeline: {
          layout: layout(entries.map((entry) => entry.timestamp)),
          contextLayout: layout(contextTimes),
          compactions,
          label,
        },
      }),
  });
  app.mount(el);
}

window.TimelineGraphs = { mount, unmount };
