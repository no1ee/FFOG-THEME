# FFOG — Project Concierge

A local agentic dashboard that pairs with **Claude Code** running on your
machine. One clean UI for all your projects; a background agent (Claude Opus
4.7, run as a separate `claude` CLI session) watches each project, proposes
next moves, and dispatches your instructions to the right project's worker
session.

## How it stays sane across many projects

Cross-project mix-ups are the failure mode. The architecture takes that
seriously:

| Primitive            | What it guarantees                                                                |
| -------------------- | --------------------------------------------------------------------------------- |
| **One worker per project** | Each project gets its own `claude` subprocess pinned to a fixed `cwd` and a fixed `--session-id`. |
| **Project-scoped router**  | A single Opus 4.7 "router" session runs in `data/`, never inside a project tree. It only emits JSON suggestions; it never edits user code. |
| **Tagged prompts**         | Every prompt forwarded to a worker is prefixed `[project:<id>] …` and gets an appended system preamble forbidding cross-project work. |
| **Single-flight queues**   | Each worker processes one prompt at a time. No interleaving, no shared scratch. |
| **Append-only event log**  | Every spawn, exit, prompt, suggestion, and approval lands in SQLite, scoped by `project_id`. |
| **Kill-and-respawn**       | On any contamination signal you nuke the subprocess; the next send starts fresh. |
| **No cross-project lookups** | The `SessionManager` API only accepts a `projectId`; there is no shared context to leak through. |

## Layout

```
backend/   Node + Express + ws + SQLite. Spawns and supervises claude CLI sessions.
web/       Vite + React + Tailwind. Talks to the backend via REST + WebSocket.
data/      SQLite db, per-project transcripts, scheduler state. Gitignored.
```

## Requirements

- Node 20+
- The `claude` CLI on your `PATH` (the same Claude Code you use day-to-day)
- An Anthropic account that can run `claude-opus-4-7`

## Run

```bash
npm install
npm run dev
```

That starts:

- backend on `http://localhost:5174`
- web app on `http://localhost:5173` (proxies `/api` and `/ws` to the backend)

Open the web app, click **+ Add project**, paste an absolute path, pick a
focus category and an autonomy level, and you're set.

## Per-project controls (collapsible sidebar)

For each project you choose:

- **Focus** — what the background check looks for:
  - `direction` · high-level direction and next milestone
  - `todos` · outstanding TODOs / unfinished work
  - `gaps` · missing tests, docs, error handling
  - `enhancements` · user-visible improvements
  - `improvements` · refactors, perf, code quality
- **Autonomy** — risk vs. control tradeoff:
  - `Ask first` — every suggestion waits for your approve/reject
  - `Auto-act` — approved items execute as soon as the router emits them

You can change either at any time; the next check uses the new setting.

## How a check round works

1. Scheduler ticks (every 5 min) or you click **Run check now**.
2. Backend collects cheap signals from the project: `git status`, recent
   commits, TODO/FIXME hits, last few user instructions.
3. Signals are handed to the **router** session (one Opus 4.7 process running
   in `data/`, isolated from every project tree). It returns JSON
   suggestions only.
4. Suggestions are persisted, broadcast to the UI, and — if autonomy is
   `auto` — handed straight to the project's worker session. Otherwise they
   wait for an Approve click.

## Live behaviors

- **Token streaming.** Each project's worker is launched with
  `--include-partial-messages`, and `content_block_delta` events are
  forwarded over WebSocket as `delta` messages. The UI accumulates them
  into a streaming reply pane with a blinking caret. If the local `claude`
  build doesn't emit partials, the backend falls back to forwarding the
  final assistant message as a single delta so the UI still renders.
- **Cancel.** While a run is in flight, the Send button becomes Cancel.
  The backend kills the current child via `SIGTERM` without flushing
  queued items; cancellation surfaces as `run.end {cancelled: true}`.
- **Status board.** A flight-board-style strip pinned to the top shows
  one row per project — always the latest event for that project.
  Older rows for the same project are replaced, not stacked. The whole
  panel collapses with a click. Rows highlight briefly when they update,
  and clicking a row jumps to that project.

## Notes

- The router session deliberately has no access to project files; it only
  sees the summary you let the backend send it.
- Worker subprocesses inherit a `FFOG_PROJECT_ID` env var so any custom
  hooks you wire up can double-check they're in the right place.
- Per-project transcripts land in `data/sessions/<projectId>.jsonl` for
  debugging and audit.
- Two emitter channels keep the event log honest: `event` (persisted in
  SQLite) carries logical events; `stream` (live-only) carries
  per-token deltas so the SQLite log doesn't drown in noise.
