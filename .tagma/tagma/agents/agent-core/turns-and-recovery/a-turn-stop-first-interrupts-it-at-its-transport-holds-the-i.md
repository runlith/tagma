---
id: 01a15f2f-f20b-77f7-94c7-0a2334be8310
title: A turn stop first interrupts it at its transport, holds the intent in process memory, and any end under a standing stop is aborted
ord: 12
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d47031f1f3
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunLifecycle.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunExecution.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStopping.ts
  - kind: file
    ref: packages/agent/src/thread/transport/contract.ts
  - kind: symbol
    ref: packages/agent/src/thread/AgentHarness.ts
    symbol: engineHandlesOf
  - kind: symbol
    ref: packages/agent/src/thread/run/lifecycle/closing.ts
    symbol: makeRunClosing
  - kind: symbol
    ref: packages/agent/src/thread/run/scheduler/queue.ts
    symbol: makeQueues
---
Every stop entry — `stop_run`, `stop_agent`, scheduler interrupt-task, rewind, agent restart, archive, delete, project and worktree removal — goes through `ThreadStopping.stop`. The stop entry reads the thread's metadata row, not its history: a stop needs only the thread's transport and capabilities, and history reading grows with its length and can wait on the journal lane at an offloaded thread. `ThreadStopping.stop` takes the thread's current turn (another's expected turn is `run-mismatch` with the current one); a caller that waits for the end (delete, rewind, `stop_agent` on a step) stops and waits on exactly the turn it picked, even if its end is already recorded — otherwise deletion or rewind would proceed while a native turn still holds its fiber. It also writes a `stop` note on the run's activity: door, `by`, expected turn and outcome; note time is receipt time. `RunExecution.stop` sets the stop intent in `RunControl` and immediately calls `interrupt` of the transport holding the turn; the durable `stopRequest` is written in parallel with the interrupt and is needed by restarts and foreign processes. So the turn end in this process can arrive before the durable request. `RunLifecycle` at any end merges the in-memory intent with the row's `stopRequest` and writes the outcome with the same end record — without that, a native run interrupted before the request write would end `failed`, and withdraw and the marker would be lost.

Any end under a standing stop is `aborted` with `stoppedBy`. A turn the agent managed to finish itself also ends `aborted`, with progress `LATE_STOP` (the stop was late), and the words that turn processed are confirmed as with `completed`: otherwise the next turn would get them a second time. Withdrawing such a turn takes nothing — it already answered. An unanswered turn opened by another agent's task or interrupt stays aborted rather than withdrawn: stopping execution does not retract the accepted assignment. Its addressed text stays in history, and continuation inherits the same open request until a final report closes it. An unconfirmed opening keeps that protection while its words remain pending, including an interrupt with no reporting obligation or a task whose obligation closed on detachment. Lapse marks unread words unconfirmed before acknowledging them; a still-running words-only turn then withdraws with the unread report and wake intent in the same transaction. A lapse after the run ended reports the unread words without changing that run's end or cutting its history.

A reader steer whose read or unconfirmed fate reaches the core only after its turn ended — the turn was still showing it waiting when it stopped — is recorded into that ended turn and returned to the queue (`RunReports.fate`). It stays owed: the scheduler opens the next turn for it like any unread steer, and that turn neither says it again nor hands it to the transport, since the journal already holds its signal; the opening acknowledges it (`queuedTurns`). A transport that cannot continue without words gets it again as the opening words. Without this, a word the vendor took across the interrupt counted as read, no turn opened, and Esc on a word shown waiting silently dropped it.

The `interrupt` receipt: `interrupted` — the transport executed the interrupt, `no-turn` — it holds no turn. A turn with no holder and a turn whose holder answered `no-turn` the core ends itself; it reports such a stop only to the transport the flow is bound to (ACP thus revokes the vendor turn left without a link), not to all transports, and that message's failure does not cancel the end.

A stop with no running turn answers `nothing-running`, but if the thread's last turn ended in a stop, the core calls the transport's `interrupt` with that turn once more. A Tagma turn ends on receipt, while the vendor agent may still be answering the cancel and keep working; without that the repeated Esc would never reach it. A transport with nothing left of the turn answers `no-turn`.

A turn owned by another live process answers `requested` immediately ([[fcbe2a1d]]). The stop answer does not wait for `RunSweep` cleanup: it runs after the answer, with outcome as a `swept` note on the run activity.

On host close the call gets the stop reason and a warning: interrupting does not prove rolled-back side effects, so a retry checks the stored outcome and current state. The bash answer keeps the producer's reason from the cancel decision: a departed host does not mean the operator cancelled. An explicit stop names the known initiator; without one the answer does not attribute the stop to a human.
