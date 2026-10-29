---
id: 01a11c9a-6edb-7ed8-b517-60b0a621fbb3
title: "Terminal CLI on the core: every thread has a row and a journal, a turn is a run, an end with no Stop is derived from the vendor transcript"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/drive.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/events.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/journal.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/runs.ts
---
Goal: a `terminal` thread runs on the core like any other.
- It has a core row and a journal.
- Its turn is a core run: the core opens it or recognizes it by observation.
- Its questions are `Questions`.
- Its parent report is the settlement outbox.

The `terminal` adapter holds the process in a PTY, hooks and screen, and tells the core what they prove. It has no thread life, run lease, queue or reports of its own. Terminal evidence is weaker than the protocol, and this spec says how the run ends when there is no end event.

## As it was before this work

- **A run is a process session.** Birth creates no core row and journal ([[e47bd3fc]]). `SessionDriver.start` opens a session and immediately delivers inbox items with `deliveredToRunId = session.id` (`sessions/drive.ts:181-219`). `current` hands out the session id, and `withExternalRuns` substitutes it as the run id.
- **Work is a second state machine** in the facet: `working`, `waiting`, `idle`, `unknown` by hook occasion and turn id (`observations/work.ts:119-162`).
  - `unknown` in the list becomes working ([[fe977076]]).
  - Every `attend` after a restart makes work `unknown` with the `authority-lapsed` reason (`observations/landing.ts:62-109`): events that arrived while the server was down are lost, and their absence proves nothing.
  - While `unknown`, the CLI counts as free to print (`speakable`, `drive.ts:329-346`).
- **Lost events.** Only file records for authorship are laid to disk (`hooks/pendingWrites.ts:4-13`), and they are handed over on the same session's next hook event (`dispatch.ts:233-235,282-297`). A turn event while the server is unreachable is lost: `report` answers `undefined` (`dispatch.ts:185-218`).
- **Words.**
  - While the CLI is busy, the word stands in the queue.
  - On the Stop hook `harness.stop` takes the queue claim and hands the words over as a continuation of the same turn (`turns/deliveries.ts`, `dispatch.ts:463-501`), and `continuation` makes work `unknown` (`work.ts:122-124`).
  - A free CLI gets the word printed into the PTY.
- **Reports** are `ReportEmitter`: `turnAnswered` on `answer_harness_turn`, `sessionEnded` on the process end, and `asked`, which sends the parent an `envelope:ask`; the `announced` map in memory.
- **Questions** are `facet.question` with `hook` (`PermissionRequest` → `judge_harness_call`) and `screen` (screen widget) sources. The slot is one. The hook waits for the answer by polling until `PERMISSION_TIMEOUT_SECONDS` (`dispatch.ts:445-461`), then the CLI draws its own widget.
- **Lease** is `session.ownerId` and `heartbeatAt` in the facet. The heartbeat rewrites the facet every 5 s on every live session (`drive.ts:523-536`), and the execution end waits for the `discharge.decided` event (`drive.ts:522`). Recovery scans all facets by `json_extract` (`drive.ts:430-444`). `stop` waits by polling `while (stopping) sleep` (`drive.ts:409-411`).
- **Profiles** differ in evidence strength:
  - Gemini and Grok have no turn id (`unturned`);
  - Gemini has no final-answer key (`answerKey: null`, `vendors/gemini/row.ts:129-130`);
  - Grok has no permission hook (`grok/row.ts:80`);
  - on Cursor the permission hook is `beforeShellExecution`;
  - vendor-transcript readers exist for Claude, Codex, Grok, Devin and Cursor (the vendor row's `metadata`, `readHarnessTranscript`).

## Measurements before implementation

Each is a trial on the current CLI version. The outcome goes into the profile and into the research block under [[287a4906]], not into core code.

- **T1. A turn end the operator interrupted.** Whether Stop fires on Esc in the TUI for Claude Code, Codex, Cursor, Gemini, Grok and Devin. What the vendor transcript writes: on Claude Code a user-interruption record is expected. Whether there is evidence of a return to the prompt: a `Notification` with `idle_prompt` on Claude Code, a readable screen.
- **T2. Words typed into the TUI mid-turn.** When `UserPromptSubmit` arrives and with which turn id: at once (the word joins the live turn) or after the turn end (a separate turn).
- **T3. Printing right after Stop.** Whether the CLI accepts words typed at the Stop-hook moment, and whether `UserPromptSubmit` confirms them with a marker.
- **T4. The longest toolless call** of each CLI with no hook events: the profile's `callEnvelope`, or `none` when there is no limit.
- **T5. Transcript.** Whether transcript records carry a timestamp on each reader (Claude, Codex, Grok, Devin, Cursor), whether its clock matches the server, including in a guest environment, and how the vendor records a user interruption.

## Goal

**Row and journal.** A terminal-thread birth creates a core row with the `{ adapter: 'terminal', profile: <vendor> }` binding, `agentId: 'harness'` and a model choice, and opens a journal like any thread. The facet stays the adapter row ([[a63eba68]]).

**Run opening.** The core opens the run, and `launch` executes it:
- no process — launch the CLI with the prompt in argv, as `terminalArgv` today;
- the CLI at the prompt — print the words into the keyboard lane, with the inbox items' markers (`inputWords`).

The host's print receipt decides the words' fate ([[2121a95f]]): a refused write → `returned`; written or unknown → the words are delivered, and `UserPromptSubmit` with the markers confirms their `fate(read)`. Words written with no marker are never repeated: the CLI may have queued them while busy.

A prompt carrying Tagma markers and the operator text — the operator finished the line and pressed Enter — reads the words of those markers, and the rest of the text goes as the operator's words in the same message. When the run of those markers is still open, it is its turn. When it already ended or is dropped, it is a new `observed` run, and the Tagma words move into it. When the markers' items are already closed by the read deadline, the words join the `observed` run only as the prompt text: no `signal` is written on a closed item, and there is no second report.

**Next turn.** Words arriving mid-turn stand `queued`. After `ended` the core follow-up wake opens the next run, and `launch` prints them at the prompt (T3). No continuation via the Stop-hook answer. The queue claim, `replay` and `acknowledge`, the `harness_delivery_claim` table, the `stop_hook_active` branch and the `continuation` event leave with it.

**A turn with no Tagma.** A main-agent turn start with no Tagma marker gives `observed`: `UserPromptSubmit`, when T2 says it is a separate turn, or a main-agent tool call arriving with no open run (resume with no prompt, a lost start). When T2 says the operator words join the live turn, they go `step` as reader words into the open run. Stop, notifications and subagent events never open a run. The adapter recognizes a subagent event by its own sign (`subagentOf`): on Claude Code it is `agent_id`, on the rest by measurement. The contract's `observed` rule decides the overlap with a Tagma run ([[2121a95f]]).

**Steps.**
- `PreToolUse` → a tool-call record (`input-available`).
- `PostToolUse` and `toolFailure` → its settlement via `settleTool`.
- Events with no record → only movement.

Path touch, row authorship and law stay hook roles as today: they are no run facts.

**Turn end.** The end event is the Stop hook: the final message (`answerKey` of the profile, on Claude Code `last_assistant_message`) is written as an assistant record, then `ended(completed)`. With no answer key (Gemini) the run ends `completed` with no message.

When no Stop arrived, the end is derived from the vendor transcript.
- **What is read.** The transcript tail from the end backwards, down to the first record older than the run start: cost grows with the turn length, not the file, and on the hot `UserPromptSubmit` path nothing is remembered. The adapter takes the transcript path from the session's hook events. In a guest environment and sandbox the file is read via `Environments`, as metadata today (`metadata/file.ts`, `readHarnessTranscript`). A profile whose transcript records carry no timestamp or whose clock diverges from the server (T5) reads from the byte offset the server takes at the run open, not the whole file.
- **Positive evidence:**
  - a final assistant message → `completed` with it;
  - a user-interruption record → `aborted` by the reader, and the parent report stays silent, as on native.
- **A "new turn start" signal**, while the run is open: the previous turn definitely ended. With no positive evidence, or when the profile has no transcript reader, the run ends `completed` with no message and the `end-unobserved` reason. The end derivation and the next-turn opening are one record plan.
- **An "idle return" signal** (a vendor idle notification, when T1 confirms it, and on a profile without one a prompt screen on N consecutive reads with no hook events between them): the end is placed only on positive evidence. An empty transcript here means the turn may still run, and the run stays open. The screen is read only while the run is open and silent longer than the profile window.
The terminal adapter has two timers per thread, and each lives only while its reason stands: a wait timer (a word waits behind a silent run) and a read-deadline timer (words written and unconfirmed).

- **"A word waits behind a silent run"**: while a word waits in the queue behind an open run, the adapter holds a wait timer for the moment the run stays silent past the profile window. Then it reads the transcript tail and ends the run on positive evidence; with no evidence the timer stands again for the next window. Stop, the run end, the resource end and the word leaving the queue drop the timer. With no waiting word there is no timer. That is how a run whose Stop is lost closes, on a profile with no idle evidence.
- **Run words unread.** A Tagma run whose words are written but whose read is unconfirmed never ends by derivation: the CLI may be busy with a turn Tagma never saw, and will read them after. That turn's events go into the open run. The read-deadline timer ([[2121a95f]]) stands at the words' write. The write moment sits in the adapter row next to the send record, so after a restart `adopt` and watch start set the timer again. The timer lives while the resource lives, even when the words' run already ended. When it expires, the adapter first reads the transcript tail: the printed words' marker in it is `fate(read)`, even when `UserPromptSubmit` was lost. With no marker it reports `lapsed`, whether or not turn events ran. The core closes the words as "read unconfirmed" with one report to the sender. When the run still runs and has no other records — the CLI lost the words (a trust dialog, a menu, Esc reset its queue) — the core drops it with no `interrupt`: the single record is the message with the words, and withdraw removes it. The queue's next word leaves on its own run. A run with turn events continues, and its end no longer reports on the closed words. On a profile with no transcript reader, a read whose `UserPromptSubmit` is lost is indistinguishable from a loss by deadline: a weakening, and the thread row names it.
- The profile's `ends` set says which of these evidences the vendor has. The thread row names which end Tagma may not see.

A process exit with an open run follows the contract's shared rule: a human closed the process (zero code, `/exit`, closed window) or Tagma interrupted it — `aborted`, otherwise — `failed`.

**Order and stale events.**
- A turn with no id (`unturned`) binds to the thread's single open run: a terminal thread has one.
- An event captured (`capturedAt`) before the open run's start belongs to the previous run and answers `settled`.
- A turn event the hook could not hand over while the server was down is lost, as today. After a restart the end missed in the downtime is derived from the transcript, while tool calls that ran in the downtime never reach the feed: a `feed: turns` weakening, and the thread row names it.

**Words mid-turn.** `steer: none`: Enter and Tab write a follow-up. A cancel drops the unpassed word from the inbox.

**Questions** (cut 2 of the core; the court is [[4a024c48]]).
- `PermissionRequest` → judge → on `ask` — `asked(run, question)` with the vendor call id as the key and the "hook" route. The hook waits for the answer on a long server wait, not by polling.
- The "hook" route lives while that wait holds. When it ends with no answer, the server knows and marks the route dead.
- A screen widget that appears while the run has an open question with a dead "hook" route is the same question, not a second one, when the widget asks about the same call: the call-text and frame check, as `sameWidget` and `waitForWidget` today (`asks/screen.ts`, `sessions/keyboard.ts`). Then the question gains the "keys" route. A widget about another call is a new `asked` question with the widget's options.
- The answer goes on the live route. When no route is live, the answer is held on the question with the "answer given, never handed to the vendor" mark ([[2121a95f]]) and leaves on keys only into the same call's widget, once, when it lands. Until the answer is handed over, the question is open, and the run stays `awaiting`.
- A print with an unknown receipt never repeats: the question keeps the mark and the reason, and the operator sees it.
- A question the vendor decided itself is closed by the adapter with a `resolved` report: `PostToolUse` or `toolFailure` of the same call arrived, or that call's widget disappeared while Tagma printed no keys into it (the `sameWidget` check). A widget that disappeared after Tagma printed is the answer-delivery confirmation via `TransportAsks.answer`, not `resolved`. The undelivered answer closes with it, and `awaiting` drops. That call's `PreToolUse` arrives before `PermissionRequest` and proves nothing, while other calls' events run in parallel. On a profile with no call id (Gemini, Grok) such a question is only closed by the turn end: a weakening, and the thread row names it.
- The core writes the `awaiting` stage. The `facet.question` slot and the `hook` and `screen` sources are removed.

**Reports.** The settlement outbox sends the parent report at the run end, with the run's last message, by the same core rules as native. `ReportEmitter` is removed entirely, together with `envelope:ask` and the `announced` map. The end of a request turn never closes it: only an explicit final answer closes it, which the CLI sends via Tagma MCP ([[0f8d8726]]).

**Interruption.** The profile's `interrupt` is `resource` until T1 shows the interrupt key (`INTERRUPT_KEY`) ends the turn with an observed end. After that the profile declares `run`: the process stays.

**Process observation.** The adapter observes every standing resource's execution end via the execution host's event — run open or not — as `discharge.decided` today. The adapter has no observation timer of its own; one wait on the resource with a long host poll stands behind the event (`executions/terminals/endings.ts`), and its price is one fiber per resource. At server start the adapter reconciles standing resources against live host executions in one request.

**Restart.**
- The PTY lives in the execution host. The reaper calls `adopt(run)`. The adapter opens a lane to the live PTY and reconciles the end evidence by the rule above. When the turn ended while the server was down, the adapter reports the end, not `adopted`.
- With no PTY — `declined`, and the core cuts the run by the [[7e9130bd]] table.
- `stop` waits for the execution-end event, not for polling.

**Default profile capabilities:**
- `steer: none`, `continue: false`, `history: none`, `compaction: none`, `modelMove: pinned`, `pictures: false`;
- `openings: core-and-observed`, `feed: turns`, `guidance: hook`, `screen: true`;
- `ends` and `callEnvelope` — by T1 and T4;
- `law`, `touch`, `authorship` — by the vendor hooks; `usage` — `partial` on a profile whose transcript carries request spend, else `none`; `aside: none` ([[f822dd50]]).

**Adopting** a hand-launched CLI (`adoption/`) gives birth to a thread with the `terminal` binding and a shell resource. Its turns arrive as `observed`. The idle policy ([[570382ca]]) never touches its process.

**Metadata** (vendor model, title) is read on turn boundaries, not by polling every 5 s per session. When the model was changed in the TUI between turns, the row shows the old one until the next turn.

## What is removed

- the work machine in the facet: `observations/work.ts`, the `working`, `waiting` and `unknown` states as life, `harnessSessionAtRest`, `harnessAttention`;
- in `SessionDriver` — delivery, `receive`, `send`, `speakable` as a decision, `finish` and `report` as a run end, `settleInput`, `settleHeld`, the `reported` flag, the `session-reporting` refusal;
- `turns/deliveries.ts` entirely: claim, `followup`, `acknowledge`, `answered`;
- `turns/reports.ts` (`ReportEmitter`), `turns/hookAdmission.ts` as a report writer;
- the `hook` and `screen` sources of `facet.question`;
- the per-session facet heartbeat, the `standing('terminal')` scan, polls in `stop` and in the hook-question wait;
- the hook `touchState` file: `RunGuidance` keeps the direction count ([[2121a95f]]).

## What came out differently in construction

- **Migration.** The step moving terminal sessions into core runs is folded into the base migration with the rest (the step-folding rule), so the database-migration end-to-end test with unfinished terminal work no longer runs: the copy below the base refuses. `adopt` and restart tests prove unfinished-work recovery.
- **Stop during launch.** A Stop arriving before the CLI session stands ends the run by the adapter itself: the run is marked stopped, `open` of a session under an already-stopped run refuses `run-stopped`, and written-but-unconfirmed words end the run `aborted`, not `withdrawn`.
- **The "What is removed" list** is empty. `settleHeld` in `sessions/roots.ts` delivers answers waiting for the session root's proof, not the old word delivery. `stop` waits for the observation fiber or the row event; the hook-answer wait is a long server wait, repeated only after a link failure.

## Acceptance criteria

The implementer proves on scripted hooks, a fake PTY and a fake vendor transcript:
- Turn:
  - a word into a free CLI opens a run, `UserPromptSubmit` with the marker gives `read`, Stop closes the run with the final message in the journal;
  - the parent gets one outbox report.
- A word mid-turn stands `queued`, and after Stop opens the next run by printing at the prompt.
- An operator turn straight into the TUI is an `observed` run. A simultaneously open Tagma run drops with no process interruption and no "interrupted" record, words are never printed twice, and a later read of the printed text moves it into the run where it was read.
- A subagent Stop and a notification with no open run never open a run.
- Esc in the TUI with no Stop: the next turn start ends the run on the transcript — `aborted` by a reader when the vendor writes the interruption, otherwise `completed` with `end-unobserved` — and opens a new turn in one record.
- A Stop lost in server downtime: after `adopt` and the idle-return evidence the run ends `completed` with the transcript message.
- Idle-return evidence with an empty appended transcript never ends the run.
- A word that stood behind a silent run whose Stop is lost ends it on the transcript, and the word leaves on the next run.
- A print the host refused to record fails `launch`, and the words return. Written-but-unconfirmed words never repeat, the run never ends by derivation, and a later read moves them into the run where they were read.
- A word that stood behind a run silent for less than the window sets a timer for the window end instead of checking at once; with no evidence the timer repeats while the word waits; the word leaving drops the timer.
- Words written but with neither a read nor a transcript marker by the read deadline: `lapsed`, the words close with one report. With no turn events the run drops with no process interruption, and the next word leaves on its own run; with turn events the run continues. With a transcript marker — `fate(read)`.
- The read deadline survives a server restart and a run end with a live resource.
- A question decided in the TUI is closed by its call result, and the run stops being `awaiting`; a parallel call result never closes the question.
- A prompt with markers of deadline-closed items: an `observed` run with no `signal` and no second report.
- A `completed(end-unobserved)` close ends calls with no result.
- A profile with no `answerKey` ends the run `completed` with no message.
- An event captured before the open run's start is `settled`.
- Transcript reading on derivation reads only what was appended since the turn start.
- A repeat of every hook after a "restart" never changes the journal and inbox.
- Questions:
  - `PermissionRequest` → a `Questions` question → the answer → the hook decision;
  - the hook timeout and the same-call widget give one question, and another call's widget gives a second;
  - an answer given after the hook timeout holds the run `awaiting` until printed, and leaves on keys once, only into its own call's widget.
- A process exit mid-turn → `failed` and a report; zero code, a closed window or Stop → `aborted`. A dead idle PTY drops the resource with no run.
- An operator turn started on a row where Tagma already printed a dropped run's words is one `observed` run that reads both the operator's and Tagma's words.
- A restart with a live PTY → `adopted` or an end on evidence. With no PTY → `cut` by the [[7e9130bd]] table.
- `rg`: the "What is removed" list is empty.
