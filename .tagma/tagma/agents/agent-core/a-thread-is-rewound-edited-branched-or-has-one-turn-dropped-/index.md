---
id: 01a0f262-03db-7bb1-84f3-665d4263865b
title: A thread is rewound, edited, branched or has one turn dropped from any of its user messages, and a rewind is restorable until the next turn
ord: 131
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Conversation.svelte
  - kind: file
    ref: packages/agent/src/thread/HistoryFold.ts
  - kind: file
    ref: packages/chat-ui/src/entries/UserMessageRow.svelte
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadBranch.ts
    symbol: forkCut
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadRunLedger.ts
    symbol: withdrawableTurn
---
## 1 Outcome

On any of his own messages in a thread the operator can:

- **Rewind here** — this turn and every turn after it leave the model's history; in the feed they collapse into one fold ("Rewound 3 turns · the model no longer sees them" · Show · Restore); the message's text returns to the composer.
- **Edit** — the same rewind, with the composer opened on the text for rewording; sending is an ordinary send.
- **Branch from here** — a new thread whose history ends right before this message, the message text in its composer; the source thread is untouched.
- **Drop this turn** — this one turn (the message and everything its run wrote) leaves the model's history; later turns stay. In the feed it shrinks to one struck-through line with Restore.
- **Restore** — undoes a rewind or a drop while no turn has run since it.

A failed run whose failure will repeat as is (`retryable === false`, e.g. `content-policy` from Anthropic's `refusal`) offers **Rewind N failed turns** as the banner's primary action, beside **Change model…**; Continue stays, secondary. Double Esc in an empty composer opens a picker of the thread's user messages (↑↓, Enter rewinds, E edits, B branches); ↑ in an empty composer edits the last message.

A rewind that reaches past words shows, before it runs, what it cannot take back: files the thread changed in those turns (with an opt-in "revert my lines in these files"), graph writes, live child agents, the prompt-cache cost. A rewind over words and failures alone runs at once.

Agents get the same acts over their descendants' threads; the operator has them over every thread of the project.

## 2 Problem

Thread `01a0f219` (project 7) hit an Anthropic classifier refusal (`stop_reason: refusal` → `content-filter`); every later message was sent with the same context and was refused again within 4 s. The banner offered only Continue, which repeats the same request. The operator's only way out was another provider. There is no act that takes a finished turn out of a thread: a `withdrawal` is written only when a run is stopped before it answered ([[053baa26]]), a fork cuts only the last N turns ([[e771046b]]), and the operator has no branch verb at all.

## 3 What holds now (read against the code)

- History moves are `keep` (truncate), `compact` (replace the covered prefix) and `append` ([[b5a3dffe]], `packages/agent/src/thread/HistoryFold.ts`). No move removes a middle range; none restores.
- `withdrawal { runId, keepMessages }` is written by `ThreadRunLedger.abort` in the run-end keyed transition, only for an unanswered single-message turn; its transcript projection deletes every entry of the run (`transcript/eventFold.ts`), the server deletes the rows (`native-harness/transcript/rows.ts` `place`), and the wire carries `withdrawn: { runId }` only.
- No history message records the run that wrote it; `thread_history_item` is `(threadId, ord, message)`. Attribution is recoverable only by folding the log, which is append-only and keeps every message payload.
- After a compaction the covered prefix exists only as a summary in history.
- `forkCut` supports `all | none | turns(N)`; `fork_thread` is the only exposure, agent-side.
- The chat already puts a taken-back message into the composer (`ChatTurns.takeWithdrawnBack`); user rows have only Copy in `MessageMeta`; the ending banner offers Continue for every failure although `ChatRunEnding.failure.retryable` is known.
- The change record carries `runId` and `at` on every row and proves authorship per line; no act reverts a session's lines, and `discard_checkout` is path-wide and would destroy other sessions' lines.

## 4 Target model

### 4.1 One kernel fact: a rewind

A new event facet `rewound: { id, scope: 'from' | 'turn', runIds, from, to }` and its inverse `restored: { rewindId, at, messages }`.

- `runIds` names the turns taken out: for `from`, the target run and every run after it; for `turn`, the target run alone.
- History moves gain `splice { from, to, insert }`: `rewound` folds as `splice(from, to, [])`, `restored` as `splice(at, at, messages)`. The indices are computed by the verb inside its transition against the history as it stands at that log position, so they are exact where they are written and never reinterpreted later — the same contract `keepMessages` already has.
- Attribution: the verb finds a run's messages in the current history by folding the thread log with each appended message tagged by the run of the event that appended it (compaction tags its summary as no run; guidance, context and envelopes delivered into a run belong to that run). A `from` rewind cuts at the first message of the target run and removes everything after it, run-less messages included. A `turn` drop removes exactly that run's messages; a run's tool calls and results are appended by its own steps, so a whole run never splits a tool pair.
- A target whose messages are no longer in history (summarized by a compaction) refuses `rewind-summarized`: no rewind reaches before the last compaction's retained tail.
- `restored` carries the messages to re-insert, recovered by the same attributed fold as of the rewind's position. It is legal only while no turn ran and no compaction settled after that rewind; otherwise `restore-superseded`, and the fold stays readable only.
- The existing `withdrawal` stays: it is the take-back of a turn that never answered and leaves no fold.

### 4.2 Transcript projection

`rewound` marks the entries of `runIds` as rewound by that rewind (`rewound: { by, scope }`); it deletes nothing. `restored` clears the marks of its rewind. The kernel's transcript fold, the server's entry rows, the wire delta (`rewound` / `restored` facts, not only `runId`) and the chat fold all carry the mark. A rewound entry is never sent to the model; it remains readable in the feed and by `read_thread`.

### 4.3 The verbs

- Kernel (`ThreadHandle`): `rewind({ at: runId, scope })`, `restore(rewindId)`, `previewRewind({ at, scope })`, and `branch` gaining a cut `{ kind: 'before', runId }`.
- `rewind` while a run is going stops it first (without withdrawal), waits for it to settle, then appends the facts in one keyed transition keyed by the caller's call key. Pending queued turns and unread steers are taken back in the same act and returned in the answer with the target message's text, so nothing auto-starts after the rewind and no word is lost. A pending question belongs to the run being stopped and closes with it.
- Every rewind marks the context reading stale; cache warmth reports cold with `invalidatedBy: 'rewind'`.
- Tagma operations (threads module, socket doors for the operator, keyed by call): `rewind_thread`, `restore_thread`, `read_rewind` (preview), `branch_thread`. Agents: a collaboration tool `rewind_agent` over a descendant's thread (the right that lets it stop that descendant), and `fork_thread` gaining `before: <run>`. An agent never rewinds its own running thread.

### 4.4 The preview

`read_rewind` answers, for the runs a rewind would take out: turn count, the draft text it would return, files the thread's session changed in those runs (paths; lines still provably its own, lines already committed, lines another session now holds), graph acts signed in those runs, child threads spawned in them that are still live, and the prompt tokens the next request would rewrite. The surface asks for confirmation only when anything but words stands in that list.

### 4.5 Reverting the thread's lines (opt-in)

A change-record act `revert_lines { threadId, runIds }` restores only lines the record proves are still that session's, written in those runs, not yet committed. A line overwritten since, held by another live session, or committed is left in place and named in the answer. Never path-wide; never `discard_checkout`. `rewind_thread { revertLines: true }` runs it after the rewind lands and answers both outcomes.

### 4.6 The feed

- `UserMessageRow` gains the action bar beside Copy in `MessageMeta`: Edit, Rewind here, Branch, Drop turn; shown on hover and keyboard focus.
- A contiguous run of rewound entries renders as one fold row: `↶ Rewound N turns · the model no longer sees them` · Show / Hide · Restore (Restore only while legal). A dropped turn renders as one struck-through line with its first words and Restore.
- After Rewind or Edit the composer holds the text (and any taken-back queued words after it) with a chip `↶ rewound to message N` whose × restores.
- The ending banner: for `retryable === false` failures, primary `Rewind N failed turns` (the trailing consecutive failed runs), then `Change model…`, then Continue as ghost.
- Double-Esc picker and ↑-to-edit as in §1.
- Confirmation popover only when the preview names more than words (§4.4), with the revert-lines checkbox off by default.

## 5 Owners and boundaries

- `packages/agent` thread kernel ([[c3e78736]]): the facts, the splice move, attribution, the verbs, branch-before, the transcript projection, wire deltas, collaboration tools. It knows nothing of files or graph acts.
- Tagma threads module ([[edd4a99c]], `apps/tagma/server/src/threads`, `native-harness`): operations, entry rows keeping marks, history store applying `splice`, the preview's composition (it asks the change record and the graph acts; the kernel does not).
- Change record ([[372b147b]]): `revert_lines` and the per-run file facts of the preview.
- `packages/chat-ui` ([[cb732496]]): entry mark, timeline fold row, user-row actions, composer chip, picker. Product-free: actions reach the product through callbacks.
- Tagma app ([[aeb922f0]]): wiring the operations, the banner's actions, the confirmation popover, the model picker hand-off.

## 6 Rejected alternatives

- Compensating `append` for restore, or re-appending prefix copies through `compact`: breaks ordering against later appends and costs a copy of the whole prefix per act.
- Stamping the run into each history message: changes the bytes of requests and the cache digests of every existing thread, and leaves legacy threads — the one that motivated this — unrewindable.
- Deleting rewound entries (the withdrawal projection): loses what the operator must be able to Show and Restore.
- Rewinding into a summarized prefix by re-folding "as if the compaction never happened": resurrects context the budget already refused; the operator branches from before instead when the log allows it later.

## 7 Acceptance criteria

1. On thread `01a0f219`, Rewind at "What does the crypto boss have to do with it…" (translated from Russian) folds the three refused turns, puts the text in the composer, and a send with the same model answers (no refusal from the rewound context).
2. Drop of a middle turn: the next request's history lacks exactly that run's messages, keeps every later turn, and is accepted by the provider (no orphan tool pair).
3. Restore after a rewind or a drop yields the history byte-identical to before it; Restore after a later turn refuses `restore-superseded`.
4. Rewind to a turn inside a summarized prefix refuses `rewind-summarized`; the picker shows those turns disabled.
5. Rewind during a running run stops it, then rewinds; queued words come back in the answer and nothing starts on its own.
6. Branch from a message yields a thread whose history ends before that message; the source's log is unchanged.
7. The server's rows after a server restart match the kernel's fold (rows re-derived from the log agree).
8. `revert_lines` restores only provably own, uncommitted lines of the named runs; another session's lines in the same file stay byte-identical.
9. The content-policy banner shows Rewind N failed turns as primary.
10. An agent can rewind its descendant's thread and cannot rewind a thread outside its lineage.

## 8 Claims and tasks touched

- [[b5a3dffe]] (three moves) is revised to four once built.
- [[e771046b]] (branch cut counted in turns) gains the `before` cut.
- [[053baa26]] (stopped run gives its turn back) stands; withdrawal is unchanged.
- The server rows claims under [[edd4a99c]] that describe withdrawal deletion stay true for withdrawal; new claims cover marks.
- Claims are written from the code when each task lands; this decision closes into them.

## 9 Order of building

1. Kernel facts, splice, attribution, verbs, branch-before, projection, wire (task A).
2. Change record `revert_lines` + per-run file facts (task B) — parallel with A.
3. Tagma operations, rows, history store, preview (task C) — after A's contract lands.
4. Chat UI + Tagma app (task D) — against A's wire contract; its operations wiring after C.

## 10 Contract

New optional payload facets and wire delta fields; old readers of `withdrawn` are unchanged. The socket operations are additions; `fork_thread` gains an optional argument.

## 11 Stored data

The thread log only gains events. `thread_entry` gains a nullable rewind mark (migration adds the column; old rows read as unmarked). Rows are re-derivable from the log. Rollback: an older build reading a log with `rewound` facts must refuse to decode rather than fold wrongly — the payload schema is closed, so it does.

## 12 Who may do what

The operator: any thread of the project (the existing operator gate). An agent: descendants only, gated where `stop` of a descendant is gated. `revert_lines` writes only what the change record proves is the session's own; an error in that proof leaves a line unreverted, never another's line overwritten.

## 13 Long-lived things

A rewind's restorable state ends at the next turn or compaction; nothing is held in memory. Live children spawned in rewound turns keep running; their reports arrive as ordinary messages.

## 14 Bounded resources

The attributed fold reads the thread's log once per rewind, restore or preview (O(events of the thread)), an operator act. `restored` carries a copy of the re-inserted messages once.

## 15 Rollout

Running threads see nothing until an operator acts. The server needs a build and the operator's restart.

## 16 Failures

The rewind is one keyed transition: a retry with the same call key replays; a crash between stop and rewind leaves a stopped thread and the retried call rewinds it. `revert_lines` runs after the rewind lands; its failure leaves the rewind standing and is answered.

## 17 Observability

The feed fold; `read_thread` shows `rewound`/`restored` records; cache warmth names `rewind`.
