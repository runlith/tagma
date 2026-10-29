---
id: 01a118eb-3e7e-7085-8f2e-2cd0a34152ed
title: One RunScheduler opens a run, and run parts assemble from one read
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadAggregate.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunStarter.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadTurnRunner.ts
---
Goal: one owner answers "what opens a run" — `RunScheduler`, with one `admit` entry. A new opener (dealer, schema step) is an `admit` call, not a twelfth road. A run is assembled from one read at open: wake costs a single-digit number of reads, not dozens.

## Now

Runs are opened on eleven roads:
- nine `ThreadTurnRunner` methods: `sendTurn`, `open`, `wakeWithItem`, `wakeWithText`, `keepWarm`, `wakeWithQueuedTurns`, `wakeFromHistory`, `continue`, `resumeInterruptedRun` (`ThreadTurnRunner.ts:139-186`);
- compaction runs (`ThreadCompactionRunsLayer.ts:294-307`);
- hosted runs (`ThreadRunStarter.hostRun`, `ThreadHosting`).

Three more places work over them:
- `ThreadAggregate` adds a delivery-repeat road `DELIVERY_ATTEMPTS = 2` and reopening of the standing queue (`ThreadAggregate.ts:110,351-363,413-475`), while the follow-up wake policy after settlement lives in its layer constructor (`:342-349`);
- `ThreadSignals` routes words;
- `Commands.ts` `ThreadRuns` re-implements the start-key replay around the same calls.

Opening reads `entriesOfRun`, `historyOf`, and the journal three to four times for `stepsTaken`, and publishes two to three snapshots (`ThreadTurnRunner.ts:343,347,380-382,442,468`).

## What gets built

- `thread/run/scheduler`: `RunScheduler.admit(threadId, item, caller, key) → RunReceipt` — one decision function:
  - deliver into the active run;
  - queue;
  - open a run with seed and consumed inbox items;
  - persist.
  The decision is judged against the [[7e9130bd]] table. Delivery repeats and the follow-up wake after settlement live here.
- `ThreadTurnRunner` entries reduce to the distinguishable acts of the [[7e9130bd]] table:
  - new run `open(thread, seed, consumed, startKey)` — today already centralized by `ThreadTurnRunner.ts:542-575`, to which send, text, history, and queue delegate;
  - starting the created one (`open`, `:674-678`);
  - continuing a parked one;
  - adopting an interrupted one (`resumeInterruptedRun` takes the existing id, `:812`).

  The acts stay distinct, but only `RunScheduler` decides which one runs. Compaction and hosted open a new run with the same `open`, each with its own seed kind.
- `thread/run/assembly`: `RunAssembly.native | hosted` builds the run parts from one read at open: the catalog via `resolveCatalog` ([[8451c5c9]]), the door, the frozen prompt, the context anchor, the recorder. Both roads share one code.
- `ThreadAggregate` becomes a thin facade over `RunScheduler`, `Questions`, thread settings, and `ThreadDeletion`. The thread model is written by one writer with one transition — today two (`ThreadAggregate.ts:718-729` and `Commands.ts:976-1039`). It keeps the caller distinction: the operator changes settings even mid-run, while a model change to a running run refuses for an agent. The operator decides a change of this semantic separately. `ThreadToolSources` no longer rides the run machine's `R` channel and is not provided by hand seven times (`ThreadAggregate.ts:508…669`): the assembly provides it.

## Acceptance criteria

- `rg` over the package: `lease.createRun`/`launch` and their successors are called only from `RunScheduler`, and the only outside entry is `admit`.
- Opening-cost test: from `admit` to the first model request, each needed fact is read once from the agreed opening snapshot, with no re-read of the full history or command. Calls, rows, and bytes are measured at two history lengths. A warm reopen reads only the suffix. Cold assembly reads the needed materialized context once, and its O(H) cost counts separately. The snapshot publish count equals the number of distinguishable states, not an arbitrary number.
- Run conformance suites ([[523c3230]]) pass with no changed assertions.
- `ThreadTurnRunner.ts` and `ThreadAggregate.ts` (or their successors) stay under 650 lines without import; debt entries go away.
- One-writer test: operator settings persist at once, while an agent is refused a model change to a running run. A running run's assembly keeps the already-picked model; the next assembly (a new run or a re-assembled resume) takes the stored setting. Hot-switch between steps of one assembly is not introduced by this rebuild.
