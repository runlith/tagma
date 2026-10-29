---
id: 01a15eeb-6b48-7ca8-9c93-24d47031f1f3
title: "Core: one owner of the process's live turns and a stop that answers with the transport's receipt"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/agent/src/thread/run
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/turns.ts
  - kind: file
    ref: packages/agent/src/thread/transport/Transports.ts
---
One owner executes the stop of the server process's live turns — identically for every transport — and answers with the fact, not the intent.

## What stands

- **Three `halt` branches, "write then interrupt" order.** `RunExecution.halt` (`RunExecution.ts:263-320`) splits into three branches that in fact encode the transport kind: native under `track`, `transports.holds` (ACP and terminal), and "the rest". In each branch `lifecycle.stop` first writes `stopRequest` through the single SQLite writer and only then calls `transports.interrupt` (`:270-271`, `:288-290`, `:302-303`).
- **Interrupt without receipt.** `TransportRuns.interrupt` answers `void` (`contract.ts:86`), and `halt` answers `stopped` right after the call. The only repeat is `RunBeater` on every heartbeat while the request stands (`RunBeater.ts:60-81`). A transport that ignores the repeat (the Claude runner) holds the turn as long as it wants.
- **Ending ignores the stop.** `RunLifecycle.completed` writes `completed` without looking at `stopRequest` (`RunLifecycle.ts:268-298`). In the native branch the result of `lifecycle.stop` is discarded (`RunExecution.ts:270-282`).
- **`ThreadStopping.stop` (`ThreadStopping.ts:36-51`):**
  - on an expected-turn mismatch answers `not-running`;
  - a stop with `withdraw` on a thread without `history` refuses before stopping;
  - a compaction stop goes without `by` and `marker`.
- **30-second ceiling.** `ThreadEnding.stop` wraps the whole path in it, including `sweep` — team cleanup in the execution host and waiting on foreground calls (`ending.ts:24,64-77,132-138`; `RunExecution.ts:503-508`). An executed stop can answer with a `stop-timed-out` refusal.
- **Fan-out without a holder.** A turn nobody holds receives `interrupt` from all transports through `Effect.all` with fail-fast (`Transports.ts:35-43`): the first failure hides the rest.
- **The door opens the graph.** Before `execute`, the `stop_run` door opens the project graph (`invocation/admission/project.ts:152`), though a stop needs no graph.
- **Owners and entries.**
  - The "turn is going" fact has over ten owners: the database line, five collections and three `waiters` in `RunExecution`, `RunBeater`, each transport's `holds`, `RunCount`, `ThreadResidency`, `WordsInFlight`, `LaunchGate`, the server's `runningRunOf`.
  - The stop has six entries: `ThreadEnding.stop`, `ThreadAggregate.stop`, `collaboration/native/runs.ts`, the interrupt-task scheduler, rewind and delete with `awaitSettled`, archive and delete loops.

## What will stand

- **One owner of the process's live turns** — `RunControl`; the name is refined in the work, per the `ag-term` skill.
  - A transport registers its turn in it on launch and removes it on end.
  - `holds`, `RunBeater`, `RunCount`, and the `RunExecution` collections become its projections or go away.
- **`stop(thread, by, expected?)`:**
  1. Takes the thread's current turn. `expected` is a check only; on mismatch the answer is `run-mismatch` with the current id.
  2. Sets the intent in memory and at once calls `interrupt` on the transport holding the turn.
  3. In parallel writes the durable `stopRequest` — for restart and for another owner.
  4. On the `interrupted` receipt writes the turn end `aborted` with the tail sealed at the interruption point, and answers `stopped`.
  5. `no-turn` with a live turn record means the turn is orphaned: the core ends it `aborted` itself.
- **Another server process's turn.** The answer `requested` arrives at once. The owner executes the request from its own heartbeat, as now ([[fcbe2a1d]]), and the thread snapshot shows "Stopping".
- **`interrupt` contract.** `TransportRuns.interrupt` answers with the `interrupted | no-turn` receipt. After `interrupted` the transport writes nothing into the turn and continues nothing in it at the agent's. Fan-out across all transports leaves with `Effect.all`.
- **Ending under a standing request.** Any such ending is `aborted` with `stoppedBy`. If the agent managed to finish itself, the ending carries a "stop was late" mark.
- **`withdraw` is optional.** The core takes the turn back only when it can: the thread has `history` and the turn has answered nothing yet. Because of `withdraw` the core never refuses a stop.
- **The `stop_run` answer excludes `sweep`.** Cleanup runs after the answer and writes its outcome into activity. `bounded` around the stop leaves.
- **One stop entry.** Archive, delete, rewind, `stop_agent`, and the interrupt-task scheduler call the same `stop`.
- **No graph or journal.** The `stop_run` door opens no project graph and awaits no journal lane of the thread for the intent.
- **A compaction stop** writes `by` and `marker`, like any reader's stop.
- **Activity record.** Every stop writes the door, `by`, the expected and current turn, the receipt time, and the outcome.
- **Capabilities.** `thread.capabilities` is a session fact: an ACP agent declares them per session, a terminal derives them from the CLI profile, native from the model. On registration the transport declares its history and compaction kinds as a dictionary (`journal | session | none`, `core | session | none`), and the registry reconciles the registered `TransportHistory` and `TransportCompaction` against it. The "native declares `history: false` while `NATIVE_CAPABILITIES.history` is `journal`" mismatch (`record.ts:128-150`) leaves.

## Acceptance

- The parent spec's conformance set passes for every transport.
- Core tests:
  - a turn that ended itself during a stop is recorded `aborted` with the mark;
  - a stop with someone else's `expected` answers `run-mismatch` with the current turn;
  - a stop under a slow `sweep` answers `stopped` before `sweep` ends;
  - one transport's failure on an orphaned turn does not block the turn's end.
