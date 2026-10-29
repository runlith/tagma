---
id: 01a0f9a9-a2e1-76d0-bc65-c4606b54ddf1
title: A step's calls wait only for an earlier write to the same file; no other subject orders a step
ord: 122
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentToolDoor.ts
  - kind: file
    ref: packages/agent/src/agent/turn/tools.ts
---
## Outcome

The calls of one step run in parallel unless one writes a file another reads or writes.

Measured 2026-10-01 in thread 01a0f450: sixteen parallel `delete_thread` calls with `reach: 'any'` ran one after another, because each declared the same write subject `thread://reach/any` and the step queued every later call behind the earlier "write". Call `toolu_013YnGcSNypWctZUD51ZYWTq` started at 21:49:54.903 and began executing at 21:50:25.538, 1 ms after its predecessor ended; its own work took 1.07 s.

## Design

The batch orders by files, and only by files. A subject whose value is a filesystem path says so where it is built — the workspace tools' subject constructors, and any server operation that names checkout paths. The step's path accesses and the door's remembered writes read only those subjects. Every other subject — agents, threads, graph projects, worktrees, commands, spawn types — orders nothing, so a subject added later for permission alone can never serialise a step.

Two verbs aimed at one agent in one step are no longer ordered: calls in one step are independent by contract, and file read-after-write is the one dependency the step protects.

## Acceptance

- One kernel test through the step's public road: two calls sharing a non-path write subject run concurrently; a write and a later read of one file still run in order.
- Sixteen parallel `delete_thread` calls read `executingAt` at their `startedAt`.
