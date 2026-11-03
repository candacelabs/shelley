> **Candace Labs' fork of [boldsoftware/shelley](https://github.com/boldsoftware/shelley).** Upstream Shelley runs as its own program: a SQLite file, tools on the host's shell, served at `/`. [csf](https://github.com/candacelabs) runs Shelley *inside* its own server instead: one process, one PostgreSQL, every tool call in a sandbox, at `/shelley/`. These are the changes that takes. Upstream's README follows below.
>
> ## Why we forked
>
> | | boldsoftware/shelley | this fork |
> |---|---|---|
> | store | SQLite file (`db.New("shelley.db")`) | **PostgreSQL** you open (`db.NewFromDB(sqlDB, dir)`), tables in schema `shelley` |
> | where tools run | the host's shell ("bring your own sandboxing") | wherever your `claudetool.Sandbox` says |
> | mount point | the site root only | any path prefix (`/shelley/`) |
> | links it hands out | guessed: `os.Hostname()` + `.exe.xyz`, `https` | the public base you set, or none |
>
> ## What's different
>
> ### PostgreSQL instead of SQLite
>
> ```go
> // upstream
> store, _ := db.New(db.Config{DSN: "shelley.db"})
>
> // this fork: your pool, your server; create the tables once
> sqlDB, _ := sql.Open("pgx", os.Getenv("DATABASE_URL"))
> _ = db.CreateSchema(ctx, sqlDB)            // db/postgres_schema.sql, if not there yet
> store, _ := db.NewFromDB(sqlDB, stateDir)
> ```
>
> Or apply the schema yourself: `psql "$DATABASE_URL" --single-transaction -f db/postgres_schema.sql`.
>
> ### Tools run where you say
>
> ```go
> // upstream: bash runs `go test ./...` on this host, in the conversation's cwd
>
> // this fork: implement two methods, and every tool goes through them
> type Sandbox interface {
>     WorkingDir(ctx context.Context, conversationID string) (string, error) // where the tools work
>     Wrap(conversationID, command, wd string) string                       // e.g. "sandbox-entry -- bash -c '…'"
> }
> tools := claudetool.ToolSetConfig{Sandbox: mySandbox}
> ```
>
> A nil `Sandbox` is upstream's behavior.
>
> ### Served under a path prefix
>
> ```go
> srv := server.NewServer(store, llms, tools, logger, false, defaultModel, "")
> srv.SetPublicBase(must(url.Parse("https://example.com/shelley")))
> mux := http.NewServeMux()
> srv.RegisterRoutes(mux)
> http.Handle("/shelley/", http.StripPrefix("/shelley", mux))
> ```
>
> | | upstream | this fork |
> |---|---|---|
> | page | `<script src="/main.js">`, calls `/api/…` | `<base href="/shelley/">`; every asset, call, worker and route is relative |
> | conversation link | `https://<hostname>.exe.xyz/c/<slug>` | `https://example.com/shelley/c/<slug>` |
>
> With no public base set, the page works at `/` as upstream's does, and notifications carry no link.
>
> ## Status
>
> | | |
> |---|---|
> | based on | upstream `73fe06f` |
> | not merged yet | upstream's 60 later commits: they add 10 SQLite migrations (projects, workspaces, project VMs, message routes) and ~900 lines of SQLite queries that must be ported to PostgreSQL first. Upstream is merged in, never rebased over. |
> | `db` tests | on PostgreSQL (a throwaway cluster from `initdb` on `PATH`, or `SHELLEY_TEST_DATABASE_URL`): 82 pass; 21 written for SQLite (`PRAGMA`, `sqlite_schema`, FTS5 snippets) still fail |
> | `ui` | type checks and unit tests pass |

---

# Shelley: a coding agent for exe.dev

[shelley.dev](https://shelley.dev/)

Shelley is a mobile-friendly, web-based, multi-conversation, multi-modal,
multi-model, single-user coding agent built for but not exclusive to
[exe.dev](https://exe.dev/). It does not come with authorization or sandboxing:
bring your own.

*Mobile-friendly* because ideas can come any time.

*Web-based*, because terminal-based scroll back is punishment for shoplifting in some countries.

*Multi-modal* because screenshots, charts, and graphs are necessary, not to mention delightful.

*Multi-model* to benefit from all the innovation going on.

*Single-user* because it makes sense to bring the agent to the compute.

# Installation

## Pre-Built Binaries (macOS/Linux)

```bash
curl -Lo shelley "https://github.com/boldsoftware/shelley/releases/latest/download/shelley_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" && chmod +x shelley
```

The binaries are on the [releases page](https://github.com/boldsoftware/shelley/releases/latest).

## Homebrew (macOS)

```bash
brew install --cask boldsoftware/tap/shelley
```

## Build from Source

You'll need Go. `make` installs the Node.js and pnpm pinned in
`ui/mise.toml` (see `scripts/with-node`).

```bash
git clone https://github.com/boldsoftware/shelley.git
cd shelley
make
```

# Releases

New releases are automatically created on every commit to `main`. Versions
follow the pattern `v0.N.9OCTAL` where N is the total commit count and 9OCTAL is the commit SHA encoded as octal (prefixed with 9).

# Architecture 

The technical stack is Go for the backend, SQLite for storage, and Typescript
with Vue 3 + PrimeVue for the UI. 

The data model is that Conversations have Messages, which might be from the
user, the model, the tools, or the harness. All of that is stored in the
database, and we use a SSE endpoint to keep the UI updated. 

A profile's `idle_compaction_minutes` makes its top-level conversations compact
once idle that long after a turn: an idle nudge starts a turn in which the agent
compacts its own context with `compact_in_place`, which must be on (as it is by
default).
The nudge's mechanics are global; `idle_compaction_prompt` adds the profile's
guidance on what to keep.
New input cancels the pending timer. `cache_keep_warm_minutes` keeps the
provider prompt cache warm while the conversation is idle.

# History

Shelley is partially based on our previous coding agent effort, [Sketch](https://github.com/boldsoftware/sketch). 

Unsurprisingly, much of Shelley is written by Shelley, Sketch, Claude Code, and Codex. 

# Shelley's Name

Shelley is so named because the main tool it uses is the shell, and I like
putting "-ey" at the end of words. It is also named after Percy Bysshe Shelley,
with an appropriately ironic nod at
"[Ozymandias](https://www.poetryfoundation.org/poems/46565/ozymandias)."
Shelley is a computer program, and, it's an it.

# Open source

Shelley is Apache licensed. We require a CLA for contributions.

# Building Shelley

Run `make`. Run `make serve` to start Shelley locally.

## Dev Tricks

If you want to see how mobile looks, and you're on your home
network where you've got mDNS working fine, you can
run 

```
socat TCP-LISTEN:9001,fork TCP:localhost:9000
```
