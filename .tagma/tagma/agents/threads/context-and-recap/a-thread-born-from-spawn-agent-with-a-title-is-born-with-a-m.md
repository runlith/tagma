---
id: 01a113d4-d0b9-7cb9-b28a-37d7af450e30
title: A thread born from spawn_agent with a `title` is born with a manual title that auto-naming does not replace
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/rows/native.ts
  - kind: file
    ref: packages/agent/src/collaboration/births.ts
---
`spawn_agent` takes an optional `title` on any relation and history; it enters `BirthRequest`, and so the keyed act's digest: the same call key with a different title refuses `spawn-conflict`. A thread with no `title` receives the agent's name, and a root with a history copy — `fork (<source title>)` with `random` origin; the operator's branch (`branch_thread`) — the latter too.

The title is born with `manual` origin, the same as an operator rename: auto-naming replaces only `random`, so the caller's chosen name stays. A title empty after trim refuses `title-empty` in the core plane before birth (`planeRefused`, code with unblock in `refusals.ts`), not in the tool door, so the tool and the operation for foreign CLI threads receive the same refusal. The same code and meaning at thread rename (`ThreadAdjustments.setTitle`) — there a separate server refusal, because rename has no plane.

A title is not the thread's team-local `name`: the `name` in a command sets only `name`.
