---
id: 01a16e94-25d4-71b5-b4de-77ee40c6c78e
title: "Workflow stalls at the second step: participant reports wake the run thread, and its turn refuses the next agent's birth"
ord: 161
tags: ["reflection"]
fields:
  {
    "actual": "The reports woke the run thread: it made a turn itself on claude-opus-5-5 (125k input), while the chair birth refused BirthConflict run-conflict; the run hangs forever in running/dispatched, read_faults is empty, the error is only in serve.log",
    "command": "start_workflow council-probe (steps: pack answers from two spark-type agents → agent chair), run 01a16e90-e1b6-7cba-a756-55636d4c0db9",
    "expected": "After the reports, the pack engine births the chair agent and drives the run to the end; participant reports are collected by the engine, the run thread itself makes no turns"
  }
---
Filed from project `runlith`.

Sequence per 2026-10-24 records:
- 15:39:11 — `answers#0` and `answers#1` were born on muse-spark-1.3-contributor.
- 15:39:34 — the `answers#0` report arrived in run thread `01a16e90-e16b-7498-8ca8-6e0b07a45dd8` as a signal and opened its turn. The thread is of the `tagma` agent type, default model claude-code/claude-opus-5-5. It read the reports, went into grep, and wrote the synthesis itself.
- 15:40:02 — in `serve.log`: `ERROR a workflow run stopped … ThreadCallBroke: Birth of 01a16e91-a903-… under request 01a16e90-e1b6-…:chair:1:chair conflicts: run-conflict` (`collaboration/native/threads.ts:228`).
- `list_workflow_runs`: the `answers` step done, the `chair` step dispatched, `chair` member, no chair thread.

Where it breaks:
- `drive` in `apps/tagma/server/src/native-harness/workflows/library.ts` catches any cause via `Effect.catchCause` → `Effect.logError`. The run gets no failed status, `read_faults` does not see the error.
- `waitForReports` (`packages/agent/src/collaboration/collaborationWorkflowMembers.ts`) collects reports via the run thread's inbox. The same reports open a turn of that thread as an ordinary agent.

The side turn's price — 125k Opus input tokens on work nobody asked for.

The shipped `.tagma/workflows/review.json` is dead regardless of the bug: its `agentType` is `tagma`, a type that no longer exists. There were no runs in runlith before this one.
