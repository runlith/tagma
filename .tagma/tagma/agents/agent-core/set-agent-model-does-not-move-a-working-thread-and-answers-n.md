---
id: 01a1362e-5073-77d5-8f6a-3932c11cf311
title: set_agent_model does not move a working thread and answers "nothing was written", though the change was recorded
ord: 53
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1362e-728c-7e65-9440-b02838c6c7c2",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/transition/kernel.ts
---
`set_agent_model` cannot move a working child to another model, and its refusal lies about the state ([[308ce118|reflection]]).

What happened on 2026-10-13 around 16:46 UTC: child `01a13620-38ed-786c-8629-dfdc6e7a44e0` (worktree-delete) worked on gpt-6.1-sol xhigh. Two `set_agent_model(→ claude-opus-5-5 high)` calls in a row fell with `ThreadStorageFailed`: "the thread kept moving until the deadline, so nothing was written" (`packages/agent/src/thread/transition/kernel.ts`, `answerOf`). The transition transaction waits 30 s (`TRANSITION_PATIENCE_MS`) for the thread to stop moving, and a working thread never stops. After `interrupt_agent` the third call went through and answered `from: claude-opus-5-5 high`: one of the "failed" attempts had already recorded the change.

The operation's contract: a working child finishes its current step and continues the same work on the new model.

What to do:
- switching a working thread's model goes through without waiting for its rest: the request stands and is taken at the nearest step boundary, as the contract promises;
- a refusal saying "nothing was written" never stands next to a recorded change. Find out which path recorded the model on the failed transition, and make the act atomic: either everything is recorded and the answer is "moved", or nothing is recorded;
- check whether the same afflicts other transitions that change a working thread: `compact_agent` with `at`, `set_thread_transport`, and the like.

Proof: a thread continuously writing steps moves to another model with one call, and the next step goes on the new model; when the write fails, the thread's model does not change.

**Outcome (c2709097f3, ba04b172d8).** The model at the "failed" calls was recorded honestly: the stop at the step and `ThreadModels.move` went through, and what fell was the continuation — `queues.continue → openings.open → transitionNow` lost the wake race on lifting the admission hold and spent 30 s preparing a fold on a stale version, while the new run (already on the new model) wrote steps. Fixed at the owner: a repeat transition prepares the fold inside the write-unit ([[59b927cd|note]]); `readAt` without a still snapshot answers `ThreadVersionStaleError`, and the first attempt goes inside the unit too; `set_agent_model` after recording the model names the running run, and a continuation failure says the model did change. `compact_agent` goes through `controlIfPresent` without the version loop; `set_thread_transport` refuses a working thread by its contract; signals, openings, closing, and run steps go through the same `transition` and receive the fix.

Not proven by a live run: moving a working child on the working or trial server was not reproduced (provider accounts are needed); the proof is the core test (red on the old loop, green after) and the transition SQLite-itests. A narrow window remains: two competing calls under one key with a cut lane can yield `stalled: none` next to another's commit.
