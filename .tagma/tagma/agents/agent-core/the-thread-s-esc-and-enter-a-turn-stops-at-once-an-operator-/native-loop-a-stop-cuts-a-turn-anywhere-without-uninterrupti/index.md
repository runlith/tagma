---
id: 01a15eeb-6b48-7ca8-9c93-24d7bd56424f
title: "Native loop: a stop cuts a turn anywhere without uninterruptible waits, a word reads on declared boundaries"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/agent/src/agent
  - kind: file
    ref: packages/agent/src/thread/transport/native/NativeRuns.ts
---
The native loop is the reference for the other transports: it already tears the model stream at once. This spec removes the places where a stop waits, and declares when the loop reads a word mid-turn.

## What stands

- **Cut at once:** the model stream, context projection, the retry pause (`turn/call.ts:174`, `turn/plan.ts:56`, `AgentTurn.ts:314`).
- **Not cut:**
  - `ModelCalls.request` (`AgentTurn.ts:175`);
  - `signals.drain` — the journal transaction (`plan.ts:88`);
  - `door.evaluate` of the turn's rules (`plan.ts:92`); in the 2026-10-21 incident activity marked `rule-slow` at 188–313 ms;
  - `deps.boundary`, `context.observe`, `feed.push` under the semaphore.

  The stop flag is checked only after them (`AgentTurn.ts:245`).
- **Releasing a tool call** runs in an uninterruptible section with no upper bound (`AgentCalls.ts:549-577`).
- **Five seconds of waiting.** After `stop.reached` the loop waits `STOP_GRACE` 5 s before interrupting `turn.run` (`AgentRunner.ts:133,264-267`).
- **Two `RunStop`s per run:** the core's (`RunExecution.ts:82`) and the agent runner's (`AgentRunner.ts:206`), plus `AgentCalls.halted`.
- **A mid-turn word** is read only at a turn boundary in `planStep` (`plan.ts:87-90`). A final turn of one text does not check unread words (`AgentTurn.ts:407-410`): the run ends, and the word opens the next one.

## What will stand

- **One `RunStop`.** The core passes its own into the agent loop.
- **A stop interrupts a turn anywhere.** Any wait is interruptible except writing an already occurred fact.
  - A started journal write runs to completion together with awaiting the stream's writer. The turn-end record needs that same writer, so tearing away from it `aborted` would not speed anything up.
  - An answer from a door to a stopped call includes interrupting the tool and its read-back. Only Tagma tools declare read-back, and awaiting it ends on the fact ([[2522c65f]]).
  - Releasing a call stopped together with the turn does not hold the answer.
- **`STOP_GRACE` leaves.** The loop ends as soon as the stop is reached and its tail recorded.
- **The `interrupted` receipt** means the stop is spoken to the loop. Awaiting the cut itself inside `abort` is impossible: stopping at a turn boundary executes from inside its own boundary, and the wait would close on itself. The cut lands when the current wait's interruption lands. The turn end is written by the owner after the last tail ([[fcbe2a1d]]); under a standing stop it is `aborted`.
- **Word-read boundary.** A mid-turn word is read at every tool-call boundary and before the final answer. A word arriving during the final turn is read by that same turn.

## Acceptance

- Conformance set: a stop during a model stream, during `door.evaluate`, during a journal transaction, and during a tool with slow release. In each case the turn ends `aborted` with no five-second pause.
- A word arriving during the final turn is read by that same turn.
