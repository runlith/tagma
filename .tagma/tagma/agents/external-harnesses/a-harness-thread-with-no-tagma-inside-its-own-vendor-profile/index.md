---
id: 01a141bd-0e7f-7dc8-8ef7-ab6a510a47c0
title: "A harness thread with no Tagma inside: its own vendor profile and a verbatim task, Tagma only launches, shows, and collects the report"
ord: 71
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses
---
## Why

The operator compares Tagma with what the user gets out of the box: ordinary Claude Code (later Codex) with `CLAUDE.md`, no graph and no Tagma. Trials run on a polygon, where the leading agent gives both sides the same tasks and the operator watches both live.

Today the harness cannot do that — proven by a probe on 2026-10-15 (thread `01a141b5-fdb7-7b70-a18e-2b3df6f37cab`):
- `acp` (Agent SDK) replaces Claude Code's system prompt and tools with its own and never reads `CLAUDE.md` (`external-harnesses/runner/claude/lifecycle.ts:154-170`);
- `terminal` is Claude Code's native prompt and tools, but Tagma inserts `<runtime-guidance>` (the project's whole law), `<workspace>`, `<graph>` ("Tagma prime"), the `<agent-birth>` wrapper, the `<input envelope>` wrapper, the `SessionStart` hook ("Tagma session start"), and the `tagma` MCP server into messages, while Claude Code takes the operator's global `~/.claude`: its `CLAUDE.md`, automemory, Tagma and Orca hooks, skills, MCP.

An ordinary terminal (`start_terminal` with `CLAUDE_CONFIG_DIR`) is clean, but the leader sees it only through the screen: the turn's end by polling, the answer by reading the screen at 3–5k tokens. For series of dozens of tasks that never fits.

## What the user gets

A harness thread Tagma puts nothing inside — "just Claude Code", launched, visible, and driven from Tagma:
- **Its own vendor profile.** The thread launches with the given config folder (`CLAUDE_CONFIG_DIR` for Claude Code, `CODEX_HOME` for Codex; the profile already has the variable name — `adapter/hookFormat.ts` `homeEnv`). That is also a product thing: a work and a personal account, a clean profile.
- **Nothing of Tagma inside the agent.** The task reaches the CLI verbatim — no inserts, no wrapper, no birth, no law, no touch directions, no Tagma hooks and no `tagma` MCP server. The agent never knows it runs inside Tagma.
- **Tagma stays outside.** The thread shows in the app (the CLI terminal), the task leaves through `send_task`/`spawn_agent`, the turn's end arrives as a parent report with the last message, tokens and time count.

Both properties are set when the thread is born and stand on it to the end; the leader never needs to know the harness device.

## The device — the implementer decides

The implementer reads the [[287a4906|harness]] module and the terminal-thread core specs ([[a621fbb3]], [[0f8d8726]]) and writes the "Decision" section here before code: where the two parameters live (preferably the agent definition or the birth choice, not a new transport type and no `if plain` branch across the module), who reads them, and how the terminal thread learns the turn's end with no Tagma hooks. The vendor transcript as the end source is already foreseen in [[a621fbb3]] — build on it, never a second mechanism next to it. The decision must never diverge from [[a621fbb3]]: when this work does part of its cut, it does that part, never a temporary strap next to it.

Out of scope: ACP transport in this mode, and Codex past the config-folder parameter (when it needs more than `CODEX_HOME` — a separate task).

## Decision

**Where the parameters live.** Launch profile is two fields of the thread facet (row strings): `home` — the vendor config folder, and `plain` — Tagma puts nothing into the CLI. Birth takes them from the project's `threads.harnessProfile` setting (per vendor `{ home, plain }`), as transport from `threads.harnessTransport`, and writes them into the facet. The thread then lives with them to the end, and a late setting edit never moves it. The leader spawns an ordinary `harness:claude` in a project with the profile set — it never needs to know the harness device. The choice source is one birth function (`birth/profile.ts`). An agent definition or spawn-time parameter later lays the same fields down; the rest of the code never notices.

The agent definition is not taken now. A file in `.agents/` is a native agent's prompt and capabilities: the body is required, and preview builds the system prompt from it. A harness definition is a different file kind, and its parsing, preview, and spawn-time choice lie on `threads`, `native-harness`, and `packages/agent`. The outcome in the thread is the same.

Birth checks the limits, refusal `profile-unsupported`:
- `home` exists only on a vendor whose config folder is set by a variable (the hook format's `homeEnv`: Claude Code's `CLAUDE_CONFIG_DIR`, Codex's `CODEX_HOME`).
- `plain` exists only on a vendor whose transcript is found on launch facts. The end source declares that itself (`located: 'launch'`). So far only Claude Code: Tagma itself assigns `--session-id`, and the path is `<home>/projects/<cwd>/<id>.jsonl`.
- The profile belongs to the terminal transport. When the project's vendor transport is `acp`, birth refuses `profile-transport`. Moving a plain thread to `acp` refuses with the same code.

**Who reads.**
- *Birth.* `plain` → the thread snapshot of capabilities: `messaging: false` (no MCP with `send_message`), `law`, `touch`, and `authorship` — `null`, `openings: 'core'`: a turn the operator started right in the TUI Tagma never sees.
- *Launch* (`SessionLauncher`, `harnessPlace`).
  - `home` → the `homeEnv` variable in the CLI environment instead of the directory account. Without `plain`, hooks, skill, and Tagma MCP land in `home` (`installForAccount`), as in the account folder.
  - `plain` → nothing is installed and no account is picked. The environment has no grant and no session token; Tagma and vendor variables are dropped, as with any launch.
  - argv unchanged: the permission detour, the model, `--session-id`, the task.
- *Print* (`TerminalRuns`). `plain` → the CLI gets inbox words in the record the inbox keeps (`body.text` by id), through an empty line: no `<input envelope>`, no `<task from…>` markup, no birth text. `begin` lays birth only into the run seed, while the inbox record keeps the task itself. The journal gets the same words, and the print receipt stays as before.
- *Reading with no marker.* A `plain` thread's `unread` record carries the digest of the printed text, and the transcript reader gives every user prompt's digest. A match is `fate(read)` instead of the envelope marker. No match by read deadline is `lapsed`, as with markers.
- *The turn's end* (`TerminalWatch`). A plain thread has no hooks, and there is no silence to measure. While the run is open, the deadline timer reads the transcript tail at `PLAIN_BEAT_MS` and ends the turn on positive evidence: an `assistant` with `end_turn` → `completed` with that message, `[Request interrupted…]` → `aborted`.
  - That is [[a621fbb3]]'s timer and tail reader with a shorter window. The tail reads from the end to the first record of the main chain, so one step costs one end-of-file read, not the whole transcript.
  - The settlement outbox sends the parent report with the last message on the turn's end, as on any transport.
- *The transcript with no hooks.* The session key comes from the launch argv (`harnessRoot`) while no hook linked it. The Claude Code path computes from `CLAUDE_CONFIG_DIR` (or `HOME`), cwd, and the key; the formula is one — `vendors/claude/transcript.ts` — read by metadata, words, and ends.

**Plain-thread weakenings:**
- no `observed` turns;
- questions from the screen only: permission screens (under the profile's `permissionMode`) and the CLI's own question rise as parent questions, as on any Claude terminal thread ([[c4f1800d]]);
- no token count: a terminal thread has none today either;
- an operator interrupt shows only on the transcript.

On first launch in a fresh config folder, Claude Code may ask to confirm the permission detour or trust in the folder. The operator answers in the thread terminal. Until the answer, words are unread, and by the read deadline they close `lapsed`.

**Proof.** Tests on the owner's contracts:
- a system test with a fake `claude` in a real PTY: what leaves for the CLI (argv with the verbatim task, environment with `CLAUDE_CONFIG_DIR` and no Tagma grant); what birth lays from the setting into the facet and capabilities; the turn's end on the transcript with no single hook — a parent report, a second `send_task` — a second report, the `idle` thread between them in `list_agents`;
- a birth refusal for `plain` on a vendor with no `located: 'launch'`.

The live check is on its own `tagma:try`: a CLI ask from the plain thread and a bare `claude` ask in the same folder with the same copy of the config folder are compared.

## Acceptance

The implementer proves:
- **Ask purity.** A Claude Code API ask from the new mode compared with a bare `claude` ask in the same folder with the same clean config folder: the system prompt, tools, and first message match except the task text. A divergence is a defect, not an exception.
- **No hooks and no MCP.** No Tagma hooks in the thread's config folder, no `tagma` MCP server in the process; the CLI's `/hooks` and `/mcp` are empty.
- **Report.** `spawn_agent` of such a thread with a short task gives the parent a report with the turn's last message; a second `send_task` — a second report; `list_agents` shows the thread idle after each turn.
- **Visibility.** The thread terminal opens in the app, as with any terminal harness.
- Tests on the owner's contracts (what leaves for the CLI; what birth lays into the environment; the turn's end on the transcript), with no prompt-string checks.

The operator checks itself: it launches a thread in this mode on a polygon copy and watches Claude Code behave out of the box.
