---
id: 01a0d007-194a-7976-97d6-11296ad506f4
title: "An operator's compaction reaches a running thread: taken at the run's next step, or queued behind its end"
ord: 167
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0c9a4-d9d8-76ad-ba1e-7b0ade3e52c9
---
## 1. Outcome

The operator — from the app's composer, the CLI or the socket — and a parent agent through `compact_agent` can ask a thread to compact while its run is going, in one of two modes:

- **`step`** — the running run compacts its own context at its next step boundary: after the tools of the current step have settled, before the next model request. The run then continues its work by itself; nobody has to write anything for it to go on.
- **`end`** — the compaction waits in the thread's queue and runs as its own compaction run when the running run ends, in order with the turns queued around it.

On an idle thread both modes compact at once, exactly as today.

## 2. Problem

A thread at ~800k tokens with twenty more minutes of work cannot be compacted until it stops; the operator has to come back, compact, and then write something to make it continue. Every door refuses a going run today:

- the app disables `/compact` while busy (`HarnessHost.svelte.ts`, `SLASH_COMPACT && !this.busy`);
- a parent's `compact_agent` refuses `thread-running` ([[cab519cc]]);
- a steer into a compaction run answers `not-steerable` ([[74af4c17]]);
- the explicit compaction is itself a run that needs the thread's single slot ([[30a87dcb]]), so it cannot open beside one.

## 3. What holds now

- The run already knows how to compact itself mid-run: every step's projection passes through `ThreadContextAnchor.project`, which calls `prepare` on the episode's first step and `prepareContinuation` afterwards; the continuation cuts the working set, proposes its first cut as a settlement, commits it, and the run goes on ([[80ac45c4]], [[281decc9]], [[90e62a38]]). Only the budget triggers it.
- That pass refuses to summarize without a measurement proved over the request's own prefix, and waits while a warm prefix still fits ([[be6726fa]]). The explicit compaction advances the checkpoint even when the context fits and sizes its tail against the host's summary headroom ([[8d45e436]]).
- The receipt's cause `manual` is declared and constructed by nothing ([[de3e52c9]]).
- The inbox holds `turn`, `task`, `envelope` and `signal` items (`THREAD_INBOX_KINDS`); the `thread_inbox.kind` column is text and the body JSON, so a new kind needs no DDL.
- After a settle, every queued turn opener is merged into one turn ([[3e34496a]], `queuedTurnText`); nothing in the queue orders around anything else.
- The summary template already asks the summarizer to preserve the user's objective; a turn too large for the retained tail is split inside itself ([[c86a7ee4]]), so its opening message then survives only as the summary's words. The child [[c94540ce]] answers that.

## 4. Target model

**The request is an inbox item.** A new kind `compaction` with body `{ at: 'step' | 'end', keep?: string }`, accepted through the inbox like every other item: durable before it is announced, one id one payload ([[baf2db83]]), taken back while it is still queued. Its states are the inbox's own: `queued` → `delivered` to the run that took it → `acknowledged` once its outcome is written. A run's settlement closes any compaction item still delivered to it.

**`step`.** The item joins the running run and is never drained into the model's words: it is not a signal, it does not count as words arriving mid-step ([[f08fd98b]]) — a compaction must never buy the model an extra step. The run's context anchor takes it at its next projection, on either road (`prepare` or `prepareContinuation`), and runs that projection as a *requested* pass:

- no early return because the context fits or the prefix is unmeasured — the operator chose to spend the warm prefix;
- the retained tail sized as the explicit compaction sizes it, against the host's summary headroom;
- `keep` rides the segment; a deployment's own compaction form is selected in mode `manual`;
- the decision's cause is `manual`, which gives [[de3e52c9]]'s arm its producer;
- the fold's commit and the item's acknowledgement are one unit under the thread's write lock;
- a pass that fails leaves the run going on its unreduced projection, with the entry `failed` — unlike the budget's pass, the context fit before it was asked; a pass with nothing to cover records `unchanged`; a stop during the pass reads `aborted`, and the item is closed, never re-run.

If the run ends before another projection takes the item, it is still queued, and the follow-up treats it as the head of the queue.

**`end`.** The queue is ordered by acceptance and a compaction item is a barrier in it. The follow-up after a settle opens a turn from the openers standing before the first barrier; when the barrier is the head, it opens a compaction run (`ThreadCompactionRuns.compact`) that takes that item; that run's own settlement fires the follow-up again, which continues past it. An untaken `step` item of the run that just ended goes first, ahead of every queued turn.

**Around a stop, a cut and a question.** A stop over an untaken `step` item runs it as a compaction run after the stop — the way unread steers run alone ([[3e34496a]]) — and later turns wait as they do now. A cut wakes nothing: the item waits for Continue, and the resumed run's next projection takes it. A run parked on a question takes it at the step the answer resumes.

**Collapsing.** A run holds at most one `step` item; a second request answers the standing one. Adjacent `end` barriers collapse into one, and a barrier directly behind a standing `step` item collapses into it. A request while a compaction run is going and nothing waits behind it answers that run.

## 5. Owners and boundaries

- **Inbox vocabulary** — `thread/storage/inbox.ts`, `thread/inboxItems.ts`: the kind, its body, and the predicates. A compaction item is neither reader words nor a turn opener; whatever asks "does this open a run" includes it in `end` mode.
- **`ThreadRunInbox`**: holds a run's `step` item beside, never inside, its signal queue; the anchor takes it from here, and a take-back refuses once taken — the same window [[9d3f8547]] keeps for signals.
- **`ThreadContextAnchor`**: the one consumer of a `step` item. The kernel's `AgentContext` contract does not change: whether a projection reduces stays the thread's decision.
- **`ThreadCompaction`**: the requested pass as an input of `prepare` and `prepareContinuation`.
- **`ThreadCompactionRuns`**: the settle commits the item's acknowledgement in its unit; a compaction run takes an `end` item.
- **`ThreadAggregate`**: the `compact` verb gains `at` and routes idle vs running; the follow-up orders the queue around barriers. **`ThreadSnapshots`**: pending rows.
- **Collaboration** — `ThreadSpawnTree.compactChild`, `CollaborationTools.compact_agent`: a running descendant is compacted by request.
- **Tagma server and app**: `ThreadActs.compact`, the socket's `thread.compact`, `tagma compact`, the composer.
- Out: a collaborator that owns its context outside the model runtime (a foreign CLI thread) stays refused as today.

## 6. Rejected alternatives

- **A client-side queue**, as Codex's TUI queues `/compact` until the turn ends: lost with the page, and no use to the CLI or to a parent agent.
- **Stop, then compact**, as pi and Codex's core do: the work is killed and has to be restarted — the pain this removes.
- **Stop the run, compact in a run of its own, resume**: two runs around one turn against the single slot, when the run's own projection already compacts.
- **A flag on the kernel's context input**: the kernel would learn an inbox concept to carry a decision the thread already owns.
- **A synthetic "continue" after an `end` compaction**, as opencode adds after an automatic one: it writes words the operator never said; whoever wants the work to go on queues them behind the compaction.

## 7. Acceptance criteria

1. A run in a tool loop receives `at: 'step'` while a tool runs: the same run's next model request opens on the checkpoint head and a retained tail; a compaction entry of mode `manual` with receipt cause `manual` stands at that step; the run continues with no new input; the item ends acknowledged to that run.
2. The same holds with the context far under the trigger and no measured prefix.
3. `at: 'step'` arriving during the run's terminal step costs no extra model call; after the settle a compaction run runs, then whatever was queued.
4. Queue `[turn A, compaction, turn B]` behind a run: after it ends, A runs, then the compaction run, then B; the snapshot lists the three rows in that order, the middle one marked as a compaction.
5. Taking back a `step` item before the next projection leaves nothing compacted; after the anchor took it, the take-back answers not-queued.
6. A stop over an untaken `step` item is followed by a compaction run; a stop during the requested pass leaves the entry `aborted` and nothing re-runs.
7. A cut run with a queued `step` item wakes nothing; Continue resumes it and its next projection takes the item.
8. A requested pass whose summarizer fails leaves the entry `failed` and the run going; one with nothing to cover leaves it `unchanged`.
9. A second `step` request answers the standing item's id; `[compaction, compaction]` in the queue collapses into one.
10. `compact_agent` on a running descendant with `at` answers at once with the request; without `at` it refuses and names the parameter.
11. In the app, `/compact` is offered while busy; the steer gesture sends `step`, the queue gesture `end`; the pending request shows among steers or queued rows and can be taken back.
12. [[de3e52c9]] is finished by this work.

## 8. Standing claims and tasks

- [[30a87dcb]], [[8d45e436]], [[80ac45c4]], [[74af4c17]], [[f08fd98b]] hold as written.
- [[be6726fa]] gains its exception: a requested pass is not held by it. [[cd67b06f]] and [[9d3f8547]] extend to compaction items. [[3e34496a]] is rewritten for barriers and an untaken `step` item after a stop. [[cab519cc]] is rewritten: its reason — cutting a going turn is an interrupt — does not hold for a request taken at a step boundary.
- New claims are written from the code for the requested pass, the item's lifecycle, the barrier and the doors.
- [[de3e52c9]] is finished by the core task.

## 9. Order of building

1. [[d2a7785c]] — the requested pass, the inbox kind and its delivery, the anchor's take, the barrier, the snapshot rows and the aggregate verb, in `packages/agent`.
2. [[65164438]] — the Tagma server, the CLI and the app, on the verb the core answers.
3. [[5e33e086]] — `compact_agent` and `compactChild`.
4. [[46232f35]] — the child decision, after the core.

## 10. Contract

- `ThreadAggregate.compact(threadId, ownerId, { keep?, at? })` answers `{ status: 'started', runId }` when it opened a compaction run now, or `{ status: 'requested', requestId, at, runId }` when it accepted a request onto the run named — the id is the standing request's where it collapsed. A going compaction run with nothing behind it answers `started` with that run.
- `at` absent: on an idle thread it means now; on a running thread the human doors (socket, CLI, app) take it as `step`, the reader's default for a press; `compact_agent` refuses instead, because it promises a waited outcome its caller was written against.
- The socket's `thread.compact` takes `{ keep?, at? }` and answers the verb's union: an additive member; the app and the server ship together.
- The pending input's `steers` and `queued` rows carry a compaction request with `kind: 'compaction'` and its `keep`; a row without `kind` is a turn, so a frame from an older build parses whole.
- The unqueue verb takes a compaction request's id as it takes a turn's.

## 11. Stored data

A new literal in the inbox's kind union and body union; the column is text and the body JSON, so no migration. Compaction entries and receipts keep their shape; `manual` is already in the cause union. Rows written before read unchanged. Rollback: an older binary's inbox readers have no arm for the kind, so standing compaction items are acknowledged before a rollback.

## 12. Who may do what

The same gates as today's compaction: the owned-thread check in the aggregate, `ThreadActs`' gate and model-only check, descendants only for `compact_agent`. A request the gate refuses is refused before acceptance, so a wrong gate would let an owner of nothing queue a summary — the same exposure `compact` has today, no wider.

## 13. Long-lived things

- An item lives `queued` → `delivered` → `acknowledged`; a settle closes a delivered item of its run; a delete clears the inbox as it does today.
- A run's in-memory `step` slot lives in `ThreadRunInbox` beside its signal queue and dies with it.
- Races: a request against a run ending re-reads the thread as `send` does (`not-running` → idle road or queue head); a take-back against the anchor's take is decided by whichever unit commits first; two requests collapse under the thread's lock.

## 14. Bounded resources

A requested pass costs one summary call on the existing summarizer budget. Collapsing bounds a run to one `step` item and the queue to no adjacent duplicates. Nothing new is retained.

## 15. Rollout

A server restart keeps a queued item durable; recovery resumes the run and its next projection takes it, or it waits for Continue after a cut. A browser tab from before the change sends no `at`, which a running thread takes as `step`, and renders a compaction row as an empty queued row until reload.

## 16. Failures

A connection dropped after acceptance leaves the request standing and visible; a retry under the same id is idempotent. A summarizer failure, an empty cover and an abort are recorded on the entry as `failed`, `unchanged` and `aborted`; the run survives the first two.

## 17. Observability

The snapshot's pending rows show a request before it runs; the run's transcript carries the compaction entry of mode `manual`, its receipt cause and its step; the run's activity reads `compacting` while it works, which the context ring shows; the summary call's trace events carry `by: 'compaction'`.
