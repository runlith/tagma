---
id: 01a118eb-3e7e-7085-8f2e-2cd8b0203ef2
title: "Compaction by subjects: typed refusals, a strategy registry with off, step cost never grows with history"
ord: 14
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
---
Goal: compaction is split by subjects. Its refusals are typed and honest. A definition or mode picks a strategy or turns compaction off. A step's cost never grows with history length and never blocks the event loop.

## Now

- **One class for eight subjects.** `ThreadCompaction` (1082 lines without import) holds:
  - policy validation,
  - trigger math,
  - metering,
  - pruning,
  - two summarizer protocols,
  - settlement assembly,
  - calibration.

  It is built with one options bag and provided as a concrete class.
- **Strategies** are fixed at kernel assembly (`native-harness/kernel.ts:278-282`). A definition or mode cannot pick a strategy or turn compaction off.
- **Refusals lie.** The summary strategy does `Effect.die` on model failures unrelated to overflow and on empty or over-budget summaries (`summaryStrategy.ts:98,104-106,117-125`): the declared refusal union is untrue.
- **Automatic path with no degradation.** A failed automatic compaction inside a turn fails the step, while a requested one degrades to an ordinary pass (`ThreadContextAnchor.ts:218-242`). The distinction is lawful: a failed mandatory compaction may leave the request above the provider limit.
- **Calibration.** One shared compactor (`native-harness/kernel.ts:261-286`) synchronously writes the shared calibration map to a file after every observation and swallows write errors (`compaction/calibration.ts:33-42` → Tagma `compaction/calibration.ts:29-34`). This blocks the loop. Competing writers of different processes are unsettled. The `THREAD_CALIBRATION_VERSION` constant and prefixed keys (`calibration.ts:10,26,56-57`) break [[acb620dd]].
- **Step cost.** Every step does O(H) passes in `prepare`, and a cold meter re-hashes the whole history with sha256 on every run (`ThreadContextAnchor.ts:56`, `ThreadRequestMeter.ts:122-181`). This is synchronous work on the event loop, against [[7a910861]].
- **Small gaps.** Prune marks are written before the settlement transaction. `compactHistory` has no production caller.

## What gets built

- `thread/compaction/` in five parts:
  - `policy`;
  - `meter` — per thread, surviving runs and updated incrementally;
  - `pruner`;
  - `router` for summarizers;
  - `settlement`.

  Over them a thin orchestrator with positional dependencies. Compaction runs open through `RunScheduler` ([[a34152ed]]).
- A strategy registry `{ id, select?, summarize }` plus `off`. A definition or mode names a strategy ([[bb429da3]]).
- Typed refusals instead of `Effect.die`. The automatic path continues the turn with no compaction only after the owner proves the request fits the limit. Otherwise it yields a typed refusal, visible in `RunStatus` and activity. A store failure is not "summary unavailable".
- Calibration is held in memory and persisted asynchronously. The driver — an interval reset and flush on host close — connects in the same change ([[a00f91b0]]). A write failure is a diagnostic. The version and key prefixes go away with a one-time file migration.
- Prune marks are written inside the settlement transaction.
- `compactHistory` is connected or removed ([[a00f91b0]]).
- Work that stays proportional to history after incrementality moves to the owner's worker ([[7a910861]]).

## Acceptance criteria

- Ordinary-step budget test without compaction on a long synthetic tail: `prepare` and meter work never grows with the length of already-measured history. Counted in processed messages, not time. A summary or prune pass that touches selected history is bounded by it and runs off the event loop ([[7a910861]]).
- Tests: every summary-strategy refusal is a member of the declared union. Automatic compaction on a fitting request continues the turn, and on a non-fitting one refuses typed.
- Test: a definition with the `off` strategy runs a long run with no single compaction and refuses with the provider's typed overflow refusal instead of dying.
- `rg`: no synchronous file write in the calibration path. Test: after host close observations are persisted, and the next start reads them.
- `ThreadCompaction.ts` (or its successors) stays under 650 lines without import; the debt entry goes away. `ThreadCompactionRunsLayer.ts` never crosses 650.
