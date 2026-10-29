---
id: 01a17321-2895-71ed-b498-9b2711b4f93a
title: "Rollback, restore, fork, and branch of a terminal thread — by the same core as native and ACP: the journal is the truth, the adapter aligns the CLI session"
ord: 138
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14cba-e095-7bcb-bb6f-608666a5c66e
  - kind: relates
    to: 01a17315-5d83-787e-b697-da2301ff956e
  - kind: relates
    to: 01a17315-5de1-79e8-af35-62482b46ae16
  - kind: relates
    to: 01a17315-5e15-7fb3-a572-3dee224d1efb
  - kind: relates
    to: 01a17315-5e55-7250-bd2d-c0c77fb55261
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-721227bbf5fb
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-72133260ddfc
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-7214504dbcc7
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-72156eeb5374
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-7216b9c8b99d
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-72175b5ca8a7
  - kind: relates
    to: 01a17319-75a7-7026-b6a0-72189d725189
  - kind: relates
    to: 01a1732c-8663-7eed-af66-fea9880f739d
  - kind: relates
    to: 01a1732d-103b-7b7c-9f12-51b41bef914f
  - kind: relates
    to: 01a17330-2035-75da-848d-7f943746cb7c
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/seat.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/history.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/store/protocol.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/transport.ts
  - kind: file
    ref: packages/agent/src/thread/transport/contract.ts
---
Goal: a thread on terminal transport — Claude Code, Codex, Grok Build, Devin, Cursor, Gemini CLI, OpenCode in their own TUI — rolls back, restores, forks, and branches off a turn with the same acts as a native thread. Transport differences stay under the hood and are named to the user only where they change the outcome.

Terminal has none of these acts today: `terminalCapabilities` (`external-harnesses/birth/seat.ts`) declares `history: 'none'` for every vendor, and `terminalTransport` holds no `TransportHistory`. There is no fundamental obstacle: each of the seven CLIs either cuts its own session or can receive the conversation from the Tagma record.

## What the user sees

- **The same acts and words as on a native thread.** Fork in the thread menu; on a turn — Rewind (this turn and everything after) and Branch (a new thread without this turn and everything after); Restore after a rollback, while no turn followed it.
- **Rollback on the terminal surface.** The running turn stops, as on native. The CLI restarts immediately on the conversation without the removed turns, and its screen shows that conversation. The removed turn's words return to the Tagma composer. Text the operator typed into the CLI's own composer and never sent is printed into the restarted CLI's composer unsent.
- **Fork and branch** give birth to a terminal thread of the same CLI. The child's CLI stands on its copy of the conversation immediately; the source never changes. Forking a thread with a running turn takes the conversation up to that turn: the running turn stays with the source.
- **Where Rewind and Branch stand.** On the turns of the thread's journal view (chat over the journal). From the terminal surface to it — one act of the thread itself, not the `threads.terminalChat` project setting. Implementation decides the switcher's look per tagma-design.
- **Accuracy is named before the act.** Where the CLI cuts its own session, the copy is exact: the CLI holds the same context as before the point. That is Claude Code and Codex for everything and Grok Build for whole fork. Where it does not cut, the CLI's new session receives the Tagma record of the conversation: words, answers, calls. It has none of its own reasoning or full tool outputs. The thread row says so with an evidence row, as "lines observed".

## One model for all transports

Acts over history are core acts over the journal, unchanged: `ThreadRewind`, `ThreadBranch`, stop with withdraw in `ThreadStopping`. The thread's `history` capability says who holds the model context:
- `journal` — the context is the journal (native);
- `session` — the vendor session holds the context, and the adapter brings it to the journal (Claude on ACP; after this work — terminal for every vendor);
- `none` — acts refuse `transport-cannot`.

Terminal becomes a second `session` adapter on the same scheme as ACP ([[66a5c66e]]). The cut is derived from the journal and the vendor turn map, never held in reserve. A crash at any point leaves the cut point visible, and the next alignment completes it.

**How terminal differs from ACP.** A TUI has a second entrance and a screen: the operator types straight into the PTY and sees the CLI conversation. Lazy "on next launch" alignment, as on ACP, would leave removed turns in the context and on the standing CLI's screen, and words typed straight into the TUI would go over them. So terminal aligns immediately after the act, when its CLI is standing.

## Core contract

`TransportHistory` gains `moved(threadId)`. The core calls it after committing every act that changes the journal composition: rewind, restore, stop with withdraw. The act's answer never waits on it, and its failure never cancels the act: alignment derives from the journal, and the next launch repeats it.
- ACP answers with nothing: the next launch aligns it, as today.
- Terminal: CLI standing — align now; not standing — nothing, the launch will align.

`restore`, `reset`, and `fork` stay. The core never knows what the adapter does ([[e090f46d]]).

## Vendor turn map — one owner for both transports

ACP holds `protocol_turn` in the protocol store: the run, its ordinal in the vendor session, the prompt uuid, and `ProtocolRows.point`, `copy`, `trim`, `based`, `holds`. Terminal needs the same. The map and the cut-point computation move to one neutral-to-transport owner of the foreign-CLI module. ACP switches to it with no behavior change. The table changes owner, and its name states the meaning; renaming follows the migration law ([[d81b1676]]).

**A map row:**
- the run;
- its ordinal;
- the address the vendor uses to cut the root right before the run.

A row's root holds a generation, not a column: current rows belong to the thread's current session; the replaced root with its rows stands in the map header (`vendor_session.replaced`). The header also carries the account the session runs under and a fork child's provenance (source root and address); its presence means the map is kept. A hook the CLI used to take the run writes the row.

The address is opaque to the core and to the map owner: the vendor adapter that recorded it gives it meaning. On terminal Claude it is the uuid of the chain's last record before the run's first prompt, on Codex the turn id, on Claude over ACP as today. A run the session received from the journal rather than lived itself has no address.

**The cut point** is computed as on ACP: no point, a cut, or a new session. A new session results when the earliest cut run has no address, when no rows precede it, or when an uncut run's row stands after it.

**The replaced root.** When cut alignment makes root Y out of X, X's removed rows stay as the thread's replaced generation; one is stored, the latest. A restore returning exactly those runs, when Y saw no turns since, brings the thread back to X: `sessionKey` = X, the rows return. A vendor fork never destroys X, so the return is exact and cache-warm. This also applies to ACP: today a restore after an executed cut stops the process and reassembles the session from the journal. Nobody ever raises Y again.

**One root — one thread.** Alignment and fork never raise a root that holds or held another thread. A fork child always gets its own root.

## Terminal alignment

One decision function on the terminal launch path:
1. **Cut by the CLI itself.** The vendor cut yields a new root Y with the X prefix, then a `resume(Y)` launch. The cut takes the source root X and the address as input; with no address it cuts whole.
2. **Otherwise — a new session with the Tagma record.** The root starts as today (`assign`, `prepare`, or `interactive`). Journal history rides the session-opening context — over the same hook-guidance channel every terminal CLI already receives Tagma orientation through (`contextAnswer` in `adapter/hookFormat.ts`).
   - The text is built by the same journal projection that yields the hosted-session retelling on file-assembly failure (`hostedHistory` → `historyBlocks`). Its text form moves to where both the runner and terminal guidance read it ([[144dfedc]]).
   - The seed holds the newest whole turns fitting the profile hook's context limit minus orientation — that limit is far below any share of the model window. It names the count of early turns left out itself: silently none are lost. The seed is served once per session: the `SessionStart` receipt carries `seeded`, the hook asks `guide_harness` of kind `seed`.
   - The `history-seeded` diagnostic in the evidence row is recorded only when a vendor cut was due and never happened. A CLI with no cut port declares `copies: record` on its side — that is accuracy, not failure.

**When alignment runs:**
- **On every CLI launch and landing** — before printing words: the journal is checked against the map.
- **On `moved`, when the CLI is standing.** The act already stopped the running turn. The adapter:
  1. reads the TUI composer (`composer.of`) — readers exist for Claude Code, Codex, Cursor, Devin, Grok;
  2. closes the CLI with the same release as a transport change;
  3. seats the CLI on the aligned root;
  4. prints the read text into its composer unsent.

  Gemini and OpenCode have no composer reader, and their unsent draft is lost here — a named limitation.

Explanation [[08a1944e]] ("Tagma never closes a CLI") gains this exception in the same change: alignment after a history act may also close a CLI between turns.

**Failure windows** — the same table as on ACP. The Y record is one machine record: `sessionKey` = Y, the trimmed rows, the replaced generation. A launch cut (Grok) fixes Y on the first accepting hook naming Y: a crash before it leaves the provenance in the header, and the next launch cuts again.

| Crash | What the next alignment sees | Outcome |
|---|---|---|
| before the journal record | no point | nothing is cut |
| after the journal, before the vendor cut | point present, `sessionKey` = X | cut from X |
| after the vendor cut, before the Y record | point present, `sessionKey` = X | cut from X again; the abandoned Y is never read |
| after the Y record | no point | CLI rises on Y |

**Forking the child.** `TransportHistory.fork` records the child's facet in the birth record:
- the same CLI, `home`, `plain`, and `permissionMode`;
- the account the source session runs under, while Tagma can name it: the vendor session lies in its storage (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), as on ACP ([[3257c9e8]]);
- the source place;
- `sessionKey: null`;
- provenance: root X and address. The same point over the source rows before the `before` turn computes the address.

The child seats immediately, and its landing is the cut: the alignment path is the same. A child on another account or another CLI gets a new session with the Tagma record.

**Forking a thread with a running turn.** The core decides, the branch owner (`ThreadBranch`), on the declared `history: 'session'` capability — the same for terminal and ACP. A whole fork of such a thread with a running run becomes a cut before that run: the child's journal without its records, the adapter receives that run's `before`, and the `copies.point` side is judged as a pre-turn branch. The cut address is the running run's map row:
- terminal: the row is written by the hook the CLI used to take the turn, and the vendor cut slices before it; if the CLI has not taken the turn yet, the child gets a new session with the Tagma record;
- ACP: the run's end writes the run row, so the child opens a new session from the journal.

Native is unchanged: the copy takes the running turn too, open calls close with an "executed at source" answer. Spawn with `fork` of its own thread is unchanged too: the child sees the turn it was born in.

**Runs recorded before this work** have no rows. The first launch of such a session — when none of its runs holds a rollback — starts the map with addressless rows; when one does (`JournalRuns.rewound`), a new session with the Tagma record. A form step sets `history: 'session'` and `copies: record` in the core row of existing terminal threads ([[b8eb6819]]), and every launch re-declares `copies` per the vendor port: `vendor`, `record`, or `none` on the "whole" and "to-turn" sides. A hookless plain session cuts only whole and only via root preparation; without it its `history` is `'none'`.

**Subagent turns** get no rows. A Codex child-agent hook arrives with the child id, and Claude has Task agents (Orca, [[7fb55261]]).

## What each CLI cuts with

Table — from readings and live probes of 2026-10-25: [[880f739d|Claude Code]], [[3746cb7c|Codex]], [[1bef914f|Grok Build]].

| CLI | Vendor cut | How | New root rows |
|---|---|---|---|
| Claude Code 2.1.310 ([[27bbf5fb]], probe [[880f739d]]) | whole and to-turn — confirmed | Offline Agent SDK fork `forkSession(X, {upToMessageId})` with no model, then `claude --resume Y`; for a whole fork no upToMessageId is passed. It is executed by the Tagma program on the execution target where the session file lies: `tagma harness-run claude-code` gains the cut form. | The SDK rewrites message uuids, so the adapter derives the rows from the Y chain in turn order. |
| Codex 0.162.0 ([[3260ddfc]], probe [[3746cb7c]]) | whole and to-turn — confirmed | Root preparation via `codex app-server`, which already starts a paginated thread, receives `thread/fork {threadId, beforeTurnId}` with `capabilities.experimentalApi: true` in `initialize`, then `codex resume Y`. Child history_base points at the X rollout prefix; X is unchanged. | Inherited turn ids are kept and confirmed by `thread/read`. No SessionStart arrived in idle TUI; the Y-id hook arrived on the first new turn. |
| Grok Build 1.0.62 ([[504dbcc7]], probe [[1bef914f]]) | whole only — confirmed | `grok --resume X --fork-session --session-id Y`; the Y file and TUI exist before the new prompt, X is unchanged. | The source turns' promptId/prompt_id are kept; the inherited eventId still contains X, the root comes from params.sessionId/summary. |
| Devin 3000.11.92, Cursor 2026.10.22, Gemini CLI 0.37.1, OpenCode 2.1.3 ([[6eeb5374]], [[b9c8b99d]], [[5b5ca8a7]], [[9d725189]]) | none | A new session with the Tagma record. | — |

**Why Claude gets an offline SDK fork rather than `--resume X --fork-session --session-id Y`.** The point is needed either way. In TUI only the offline fork provides it: `--resume-session-at` outside print mode is silently ignored. One path closes both cuts.

**Why not in the server process.** The session file lies on the execution target, which may be a host or a sandbox. Its size is unbounded ([[7a910861]]).

**Why Tagma never edits vendor files itself.** The formats are internal, and physical rows do not equal the active branch:
- on Claude the branch is set by `parentUuid`;
- Codex paginated history refuses when the file shrank;
- Grok writes rollback markers;
- on Cursor rollback switches the blob root;
- OpenCode is a shared SQLite with global message ids.

Only the vendor's own procedure cuts, and where there is none — a new session with the Tagma record. A new vendor cut is added as a separate task after its probe; candidates are a Gemini JSON copy, OpenCode's `session.fork` API, Cursor's `/fork`.

**Codex and the folder.** Without `-c tui.resume_cwd=current` `codex resume` asks for the folder ([[7fb55261]]). A root created by a cut rises at the thread's place with no question.

**Whole Claude fork.** Both cuts, whole and to-turn, go through the offline SDK fork. Probe [[880f739d]] confirmed that `--resume X --fork-session --session-id Y` immediately yields a TUI with full history and a SessionStart with id Y, and after the first prompt keeps X's record uuids. But before that prompt no Y file is created: after stopping the CLI before the first word, reading the file by hook path returned ENOENT. Such a child has no durable root for later resume. The SDK creates a durable file before the TUI launch and rewrites uuids; the adapter derives the new root's rows from the Y chain in turn order.

## Cases the implementation holds

Orca already met and closed them ([[7fb55261]]):
- **Transcript path.** The transcript is read by `transcript_path` from the hook, never searched by id: on newer Claude Code the filename does not equal `session_id`.
- **Hook id validation.** Before the id reaches argv (`--resume`) it is validated: non-empty, no control characters, never starting with `-`.
- **Subagents.** A child-agent hook (Codex with `agent_id`, Claude Task agents) binds no root and yields no map rows.
- **Account.** A session whose root is missing from the launch account's storage rises as a new session with the Tagma record, and the thread row says why. There is no launch refusal. A fork child launches under the source session's account while Tagma can name it for launch (`HarnessAccounts.launchable`) — otherwise under the source row's pick, and then a new session with the Tagma record and reason `account` raises it. The same for terminal and ACP.
- **Word return.** A removed turn's words return to the draft even before alignment ran: a duplicate draft is harmless, loss is not.

## Out of this work

- The TUI's own commands over the conversation — `/rewind`, `/fork`, `/branch`, `/clear`, double Esc — a child spec. Until it is built, a cut made inside the TUI is invisible to the journal.
- Forking into threads of other transports and into another worktree is unchanged. Spawn with `fork` into a terminal CLI still refuses.

## Probes before code

Probes launch CLIs on the operator's accounts, so they need the operator's word. Each runs on its own short fixture conversation.
1. **Claude Code:**
   - `forkSession(X)` and `forkSession(X, {upToMessageId: U})`, then `claude --resume Y` in a PTY;
   - the TUI shows exactly the prefix;
   - Y's turn order matches X;
   - `SessionStart.session_id` = Y;
   - no new prompt needed for this.
2. **Codex:**
   - `thread/fork {threadId: X, beforeTurnId: B}` via `codex app-server` with the experimental API, then `codex resume Y`;
   - no turns from B on;
   - X is unchanged;
   - the `SessionStart` moment.
3. **Grok:** `grok --resume X --fork-session --session-id Y` — id Y, X unchanged.

A probe refuting a cut moves that CLI for that cut to a new session with the Tagma record, and the table above is corrected by the same act. Session files captured in probes become adapter test fixtures: tests hold no live CLI.

## Acceptance criteria

The implementer proves with tests through the same doors as the real caller ([[571311f8]]):
- **Parity.** The core rewind, restore, branch, and withdraw suites pass on terminal transport with a test CLI, and the journal matches native.
- **Terminal system tests:**
  - rewind with a standing CLI: the CLI is raised on the root without the cut turns, its composer text printed back, the turn's words in the draft;
  - rewind with no standing CLI: the process never starts, the next word raises the CLI on the cut root;
  - restore right after rewind: the CLI is on X again, no new session;
  - whole and to-turn fork: the child on its own root, the source root and rows untouched, a second fork of the same source — a different root;
  - a CLI with no cut: a new session, the seed carries the journal turns and names the missing ones;
  - every failure window from the table.
- **ACP.** The protocol rewind, fork, and stop suites pass with no change to the visible assertions. A restore after an executed cut returns X with no `session/new`.
- **Capabilities.** Every terminal thread has `history: 'session'`. The evidence row names the seed on cutless vendors.
- **App.** A terminal thread has Fork in its menu and Rewind/Branch on turns, and `read_rewind_points` no longer refuses `transport-cannot`.

Operator verification — forking and rolling back a live Claude Code and Codex thread in the app — is not a completion condition ([[a9cf196a]]).
