---
id: 01a0d56a-9916-7945-a5b9-62a47a4219f5
title: A CLI started in an operator's Tagma shell is adopted as a harness thread whose session lives in that shell
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/http/caller.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/service/sessions.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/credentials.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/harness/session.ts
  - kind: file
    ref: packages/executions/src/protocol/evidence.ts
---
## 1 Outcome

The operator types `claude` — or `codex`, `grok`, any CLI Tagma installs hooks for — into a shell of the terminal panel. A thread appears in the Agents list, in that shell's worktree group, named for the CLI and marked "in terminal". Its session is adopted:

- **Its page.** The thread's page shows that shell live. The tab in the panel carries the thread's mark, and each leads to the other.
- **Words and asks.** Words sent to the thread are typed into the CLI. Permission asks and turn reports reach the thread exactly as for a CLI Tagma launched. Its file writes are recorded as that thread's typed changes.
- **Leaving the CLI.** When the CLI exits, the thread's session ends and the shell's prompt is back in the tab. Continue on the ended thread resumes the same CLI session as a harness Tagma launches in its own pty. Typing `claude --resume <that session>` into a shell again adopts it back into the same thread.
- **Stop.** Stop on the thread asks the CLI to quit and leaves the shell running. Deleting the thread does the same.

## 2 Problem

A CLI started by hand in a Tagma shell edits the shared checkout, and Tagma does not see it:

- its hooks return at once without a grant (`ungranted`, `cli/hooks.ts`);
- its MCP bridge signs as a foreign session (`mcpServe`, `http/caller.ts`);
- no thread, report or change record names it.

The operator's terms (2026-09-24): no agent works in the checkout unseen, and the terminal stays a terminal.

## 3 What holds now

- **Launched sessions.** A harness session is one pty Tagma launched (`HarnessSessions.drive` → `launchHarness`). Its environment carries `TAGMA_SESSION_GRANT` (the thread's HMAC grant, `protocol/grant.ts`) and `TAGMA_HARNESS_SESSION`. Its ending is the pty's ending (`endings.decided`). Stop and deletion end that pty (`stopExecution`, `endHeldExecutions` walking the harness-named execution, [[78edd86f]]).
- **Hooks.** They are one command for every harness (`tagma hook <event>`, installed by `skill/install.ts` with no harness named). Each road starts with `ungranted()`. A granted hook reports as its thread.
- **The bridge.** It signs, in this order ([[a573ba0f]]): the grant, then the harness key it was pinned to, then the first harness id in the environment. Claude, Codex and Grok publish their session id to children (`variable` on their rows). Cursor, Gemini and Devin do not.
- **Identity variables.** `nobodyEnvironment()` strips them from every thread world and every harness launch. An operator shell carries none.
- **Process evidence.** An execution's process reading (`ProcessReport`, macOS `ps`) carries each process's parent, group and `stat`, whose `+` marks the terminal's foreground group. A related process's identity reads `unknown` ([[0f1ddc0b]]).

## 4 Target model

### The shell's key

- **Where it comes from.** Every operator shell the app opens is born with `TAGMA_TERMINAL=<shell key>`: 128 random bits, kept on its terminal row (`shell_key`, unique). Possession of the key is the proof of standing inside that shell. It is the same trust a thread's grant carries inside the thread's world.
- **Where it never goes.** `TAGMA_TERMINAL` joins the identity variables, so no thread world, harness launch or reviewer inherits one. A pty with `launchedFor` ([[e8d26502]]) and an agent's own terminal are born without a key.

### Hooks name their harness

- **The flag.** `tagma install` writes `tagma hook <event> --harness <name>` into each harness's own hook file, as the bridge's declaration already pins it ([[80935e71]]).
- **Old registrations.** One without the flag is stale, and `tagma upgrade` refreshes it ([[0341f6b1]]).

### The exchange

A hook with no grant but a `TAGMA_TERMINAL` calls one new hook door, `harness.adopt`. It sends:

- the shell key and the harness;
- the CLI's session id from the event;
- its own ancestry: its pid and each parent's, up to 16, read from the kernel;
- the storage variables of its own environment (`HARNESS_STORAGE_VARIABLES`).

The server answers, in order:

1. **The shell.** It must be a standing operator-held pty with that key, or the door refuses `shell-unknown`.
2. **The CLI's job.** It is the direct child of the shell's leader that the ancestry passes through, found in a complete process reading of that execution, in this machine's local scope ([[26430db4]]). With no such job, or a reading that is not complete, the door refuses `not-under-shell`. The job's pid is observed, never acted on ([[69128217]]).
3. **The thread.** It is found by (project, harness, CLI session id):
   - a thread whose adopted session already runs this job joins, so the exchange is idempotent;
   - a thread whose session runs elsewhere refuses `session-elsewhere`;
   - a thread with no active session opens a new adopted session;
   - with none, a root harness thread is born: owned by the operator, placed in the shell's `rootId` ([[e8d26502]]), named with the adapter's label, and carrying `sessionKey` = the CLI's session id. It is born through the unit the app's harness launch births in, less the task and the launch.
4. **The answer.** It is the thread's grant and the session id.

The hook sets both in its own process and runs its event as a granted hook. It keeps the answer per CLI session for its later events.

### The adopted session

`HarnessSession` gains `origin: 'launched' | 'adopted'`, which reads `launched` when absent, and, for adopted, `job: { pid }`. `facet.execution` is the shell. The drive for an adopted session:

- **Launch.** It launches nothing. It opens the session's lane on the shell, as today ([[6ee72bd7]]).
- **Its ending is the job's:**
  - a complete reading without the job ends it `completed`;
  - the shell's own ending ends it `aborted` while stopping, otherwise `failed` with a line saying the terminal it lived in ended.
  - The reading is taken each heartbeat.
- **Typing.** Words and ask answers are typed only while a fresh reading shows the job in the terminal's foreground group. Otherwise the words stay queued, and the thread's notice says the CLI is not in the foreground. Nothing is ever typed into the operator's shell.
- **Stop.** It never stops the execution. It spends the adapter's declared quit — keys or interrupts, a new `quit` field on the adapter — through the lane, guarded by the same foreground test. It then waits for the job to leave, bounded. A CLI still standing refuses `cli-standing`, and the session keeps running.
- **Deletion and retirement.** They take the same road. `endHeldExecutions` and `stopExecution` skip the execution an adopted session names: the shell is the operator's.
- **Continue on an ended adopted session.** It opens a launched session. The open clears `facet.execution` when the previous session was adopted, so the drive launches the CLI's resume in the thread's own pty.

### The bridge

With no grant and a `TAGMA_TERMINAL`, the CLI door sends the shell key beside its harness session header. `http/caller.ts` resolves (shell key, harness, key) to the thread whose adopted session lives in that shell under that CLI session. Otherwise the call is foreign, as today. Rows whose bridge signs with the install's MCP key (Cursor, Gemini, Devin) cannot name their session, so their calls stay foreign.

### The app

- **The listing.** `TerminalView` gains `adoptedBy`: the thread whose active adopted session lives in the execution, joined at read time.
- **The panel's tab** carries the thread's mark and opens the thread.
- **The thread row** reads "in terminal".
- **The thread page** draws the shell through `ThreadPanes`, with a link to its tab (`terminalHref`). Once the session ends, the page releases the shell's pane and shows the ended card with Continue and Open terminal, because the shell's prompt is not the thread.

## 5 Owners and boundaries

- **Server, `harness`:**
  - `HarnessSessions`: drive, stop, open and the adopted road;
  - `HarnessBirths`: the adopt birth;
  - `HarnessLanes`, and the foreground-guarded typing in `harnessKeyboard.ts` and `HarnessScreenAsks.ts`;
  - `protocol/harnessSession.ts`, and `protocol/harness/*` for the adapters' `quit`.
- **Server, the door:** `http/handlers` and `api` for `harness.adopt`.
- **Server, identity:** `http/caller.ts` for the bridge's resolution, and `protocol/grant.ts` for the identity variables.
- **Server, terminals:** the shell key at the app's start door, and `endHeldExecutions`, which skips adopted executions.
- **The CLI:** `cli/hooks.ts` (the exchange and the harness flag), `cli/door.ts` (the header) and `skill/install.ts` (the flag in registrations).
- **The app:** `features/harness`, for the thread page, row and `ThreadTerminal`; `features/terminals`, for the tab's mark.
- **Boundary.** The CLI stays a foreign program: every reading is evidence and every typed delivery may not be taken ([[6ca6b465]]). Adoption adds no control over it.

## 6 Rejected

- **Match the CLI by its command line or folder.** Forbidden ([[62049465]]): a stranger's process would be attributed to a thread.
- **Signal the job's pid to stop it.** The pid is related, not proven ([[69128217]]). A host act over a proven member would raise the host's wire and end every running terminal at the replacement.
- **Treat the shell's foreground as "the CLI runs".** A suspended CLI, a subshell or another program in the foreground would take the thread's words as shell commands.
- **Take custody of the shell for the thread.** The shell is the operator's place. The thread's lane types beside the operator, and custody would end the shell with the thread.
- **A setting to turn adoption off.** out: no one has asked. The birth is observable and ends when the CLI exits.

## 7 Acceptance

- **Birth.** `claude` typed into a panel shell births a thread in that worktree's group within the CLI's first hook. `list_threads` lists it as a harness thread with the CLI's session key.
- **Words.** Words sent from the thread's composer appear in the CLI and start a turn. The turn's report reaches the thread, and an Edit the CLI makes is a typed change of that thread (`read_changes`).
- **Suspending.** With the CLI suspended (`Ctrl+Z`), words sent to the thread stay queued, the notice says so, and the shell received nothing.
- **`/exit`.** The thread ends `completed` within one heartbeat, and the tab shows the shell's prompt.
- **Stop.** The CLI quits and the shell stands. Deleting the thread does the same.
- **Continue and resume.** Continue on the ended thread launches `claude --resume <key>` in the thread's own pty. `claude --resume <key>` typed into a shell while the thread is ended adopts it back into the same thread.
- **The bridge.** The CLI's `mcp__tagma__*` calls are attributed to the thread.
- **What is not adopted.** A CLI run under `tmux` inside the shell is not adopted, and runs as today.
- **Tests.** Server integration suites cover the exchange's refusals, birth, join and re-adoption, the ending by job, the foreground guard, stop without the shell's end, and deletion. The hook suite covers the flag and the exchange.

## 8 What becomes of what stands

- [[6ca6b465]] is rewritten: a harness session is one CLI process, launched in its own pty or adopted in an operator shell.
- [[9ecf0ec8]] and [[e3696361]] gain the adopted arm when this closes.
- [[78edd86f]] is rewritten: a thread's ending ends the execution its harness launched, never one it adopted.
- [[a573ba0f]] gains the shell key's resolution.
- [[0341f6b1]] holds unchanged: the flag makes old registrations stale, and upgrade refreshes them.

## 9 Order

This lands after [[e8d26502]] and [[91f03b67]].

1. Shell key and identity variables.
2. Session schema and the adopted drive, stop and deletion.
3. The exchange door and the birth.
4. The hook flag, the exchange in hooks and the install.
5. The bridge.
6. The app's listing key, tab mark, row and page.

## 10 Contract

- **`harness.adopt`** is a new hook door with typed refusals: `shell-unknown`, `not-under-shell`, `session-elsewhere`, and `harness-unhooked` for a harness this server carries no hook surface for.
- **`TerminalView`** gains the optional `adoptedBy`.
- **The hook command** gains `--harness`. A hook without it keeps today's behaviour.
- **The CLI door** gains an optional header.
- **Harness session rows** decode with `origin: launched`.

## 11 Stored data

- **Terminal rows** gain a nullable, unique `shell_key`. Shells opened before the change carry none and are never adopted.
- **The facet's session** gains optional fields, and old rows read as launched.
- **Rollback.** An older build drops `origin` when it decodes and would drive an adopted session as a launched one over the operator's shell, so its stop would end the shell. Rolling back therefore starts by ending every adopted session (Stop on each). This product has no automated rollback road, so the change's commit message states it.

## 12 Who may do what

- **Birth.** Adoption births a thread only for a job proven, by kernel ancestry in one scope, to run under a standing operator shell whose key the caller holds. The CLI is the operator's own action in their own shell.
- **Where it is checked.** In the door, before any birth.
- **If the check is wrong.** A process holding a leaked key could birth threads in that shell's place. It cannot type into anything the key does not name, because the lane is still the server's, per session.

## 13 Long-lived things

- **An adopted session's life.** Running until the job leaves, the shell ends, or a stop is taken. Uncertain after a lost reading, and resolved by the recovery pass ([[e3696361]]) with the job reading added.
- **The hook's cached answer.** It lives in the temp directory per CLI session, as its touch state does, and goes with the session's end.

## 14 Bounded resources

- One process reading per adopted session per heartbeat. A reading costs about 0.3 ms of table ([[a09e552a]]).
- The exchange's ancestry: at most 16 pids.
- The hook's exchange: one request per CLI session. Later events read the cache.

## 15 Rollout

- A deploy's upgrade refreshes the hook registrations ([[7f17f597]]).
- Shells opened before the deploy carry no key. The panel says nothing about it: they are replaced as they are reopened.

## 16 Failures

- **The exchange fails or is refused.** The hook stays silent — a hook is never the reason a turn fails — and the CLI runs unadopted. The next event asks again.
- **The server restarts.** It re-attends adopted sessions and re-reads the job.
- **The shell ends while the server is down.** The recovery pass ends the session `failed`, naming the terminal.
- **Racing exchanges.** Two exchanges of one CLI session join one thread, because the birth is keyed by (project, harness, session id) in one unit.

## 17 Observability

- The thread row and page say "in terminal", and name the tab.
- `read_thread`'s process line says adopted and names the shell's execution.
- The door logs each refusal with the shell and the harness at `debug`, because a CLI started outside an adoptable shell is ordinary.

## Built — divergences

Accepted by the lead (2026-09-24) before building, from what the code holds:

- **The hook flag names a harness only where the file serves one.** Grok registers in `.claude/settings.json` beside Claude, and the user layer writes that one file for both. `--harness <name>` goes into the Codex, Cursor, Gemini and Devin files. The shared Claude file carries no flag, and its hook takes the row whose published session variable equals the event's session id; no row matching adopts nothing. §10's "a hook without it keeps today's behaviour" holds for single-harness files only.
- **The exchange joins by job first.** An active adopted session on this shell whose job the ancestry passes through answers, whatever the harness and key. Only then does the (project, harness, key) road run. A nested CLI started inside an adopted one — another harness, or the same CLI after `/clear` — speaks as the thread, as everything under a launched harness does.
- **A join never moves the thread's `sessionKey`.** The code already decides this for launched sessions: once a root is bound, a report naming another root is refused `foreign-root` and the key stays. An adopted session binds its key at the exchange, so a nested CLI's reports and a same-harness new session's reports are refused the same way, and Continue resumes the thread's own CLI session.
- **`shell_key` rides `terminal_intent` too**, so a start the boot reconciliation projects stays adoptable. It is unique on `terminal` only, and both columns keep a SHA-256 digest of the key, never the key.

Found while building and in review:

- **The job is the foreground process-group leader on the caller's ancestry, not the shell's direct child** (§4 step 2). Every link from the caller up to the shell must stand in the server's own process reading with that parent; the job is the link that leads its own group and holds the terminal's foreground. A CLI started from a nested shell (`bash`, `poetry shell`, `nix develop`) is therefore the job itself, and its exit ends the session while the nested shell stands — the direct-child rule took the nested shell and typed the thread's words into its prompt once the CLI left. A caller on the server's own machine is compared in the reading's local scope, so a hostname changed after the host started does not refuse every exchange.
- **Foreground is read after the act begins.** A cached process reading older than the typing, the quit or the answer is read again once the host's one-second window passes; one still older reads as unread and types nothing.
- **The exchange is placed by the CLI's directory.** `harness.adopt` takes `?cwd=`, because the HTTP caller refuses a foreign session with no project before any handler runs. A shell of another project than the one that directory resolves to refuses `shell-unknown`, so a CLI working in another project's checkout is never recorded against the shell's. A refusal that a fresher reading cannot change (another namespace, an ancestry that misses the shell) answers without waiting for one.
- **The bridge resolves only the thread's own CLI session.** A nested CLI's bridge signs with its own key, which is not the thread's `sessionKey`, so its MCP calls stay foreign while its hooks speak as the thread.
- **Quit is measured on two rows.** Claude Code 2.1.282: Esc, Ctrl+C, then `/exit` and Enter. Codex 0.155: Esc, Ctrl+C, Ctrl+C. Grok, Cursor, Gemini and Devin declare none, so Stop on their adopted session refuses `cli-standing` saying no quit is measured; delete, archive, `answer_ask` and `cancel_ask` declare `cli-standing` or `cli-background`. Each step waits 1.5 s and re-reads the foreground; the job is waited for 10 s.
- **A refused stop restores the session** to running, clears `retiring` and gives back the question it had marked unanswered, so a refused deletion leaves the thread whole. A session that ended while the quit ran answers stopped.
- **An ended adopted session lets go of the shell.** `read_harness_screen` refuses `screen-unavailable` for it, and the server removes the kept hook answer at the ending as well as the CLI's own SessionEnd hook.
- **An archived thread is never adopted into**: a CLI resuming its key is born as a new thread.
- **`harness-unhooked` is declared and unreachable today**: every row carries a hook surface.
- **The app reads the adopter off the terminal record** (follow-up, 2026-09-25). `read_terminal` carries `adoptedBy` as `read_terminals` does; the tab mark and the close ask take it from the records the place has read, and the close reads the record again before it decides. The thread's title comes from the thread words when known and falls back to the id, so a thread outside the loaded list still marks its tab and makes the close ask.
- **An operator shell is born without identity** (follow-up). The environment that sets `TAGMA_TERMINAL` unsets every other identity variable, so a server started from a signed shell never hands its own grant to the operator's panes. Harness launches, which carry no shell key, keep their own grants.
- **A settled adoption refusal is kept per CLI session and shell** (follow-up). The door answers `shell-unknown`, `not-under-shell` (an ancestry that misses the shell, or another namespace) and `harness-unhooked` only when a fresher reading cannot change them; the hook keeps those beside the answer file, so later events of that CLI skip the process read and the request. A job not yet proven in the reading refuses `job-unproven` and is asked again on the next event.
- **Rollback** (§11). Rolling back the code starts by ending every adopted session. A build older than migration `20260924232305_terminal_shell_key` refuses to open the database, so a rollback keeps the migration; an older CLI refuses hook registrations carrying `--harness` as an unknown flag, so those files are rewritten before it runs.

## Addition — closing the shell of an adopted CLI

Decided by the lead (2026-09-24).

- Closing a tab or pane whose shell hosts an adopted session ends the shell and the CLI in it, and always asks first — even with `terminal.skipCloseConfirm` set. The confirmation names the thread: its CLI will end, and its transcript stays.
- The session then ends `aborted` through the ordinary harness ending, never `failed` as lost or crashed; the thread stays in the list with its history. The server tells a close from a shell that ended on its own by whether a stop was asked for the shell's execution: a stop asked ends the session `aborted`, none ends it `failed` naming the terminal, as §4 says.
- Acceptance: closing the tab of a shell with `claude` running in it asks naming the thread; after the close the thread reads stopped with its transcript, and the same holds with `terminal.skipCloseConfirm` on.
