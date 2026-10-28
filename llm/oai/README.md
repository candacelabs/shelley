# Reasoning rules and tests

`reasoning_replay.go` holds the outgoing Chat Completions reasoning policy;
`chat_request.go` applies it. Ordinary requests use the SDK serializer. Only
requests needing an explicit empty `reasoning_content` use Shelley's serializer.
Stored history and returned thinking are never changed.

`reasoning_policy_test.go` checks serialized requests for each route.
`reasoning_live_test.go` checks live endpoints: raw omitted/null/empty/space/text
probes, then adapter tool loops and model switches, with and without streaming.

Live tests require `SHELLEY_OAI_LIVE_TESTS=1`; each provider also needs its key:

```sh
SHELLEY_OAI_LIVE_TESTS=1 go test -count=1 -v ./llm/oai -run '^TestLiveReasoning$'
```

| Variable | Routes |
| --- | --- |
| `FIREWORKS_API_KEY` | Fireworks GLM-5.3, DeepSeek V4.1 Flash, Kimi K3 |
| `OPENAI_API_KEY` | OpenAI GPT-6 Luna, reasoning effort `none` (required for Chat Completions tools) |
| `DEEPSEEK_API_KEY` | DeepSeek Flash |
| `ZAI_API_KEY` | Z.ai GLM-5.3 |
| `MOONSHOT_API_KEY` | Moonshot Kimi K3 |

For low-rate accounts, run one case at a time, e.g.
`-run '^TestLiveReasoning$/^moonshot$/^wire$/^empty$'`. A 429 is an account
limit, not a field rejection.

When adding a rule, add a serialized-request case and a live case. One
provider's acceptance does not establish another's. DeepSeek needs the field on
tool-call history even with replay disabled; never collapse its `""` into
omission or null.
