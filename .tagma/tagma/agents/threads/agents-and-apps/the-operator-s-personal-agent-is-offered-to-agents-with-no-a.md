---
id: 01a146c4-b3fa-70f5-8ced-fd1a25dba577
title: The operator's personal agent is offered to agents with no agent.offered record; project file, app and plugin agents — to the operator only; a type hidden from an agent refuses type-withheld with a way out
ord: 5
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a146b3-b0cd-7c6d-9216-80cada88fc5d
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/library/declared.ts
  - kind: file
    ref: packages/agent/src/collaboration/types.ts
---
Who is offered a type with no `agent.offered` record is decided by the type's origin:
- an agent in code, a harness, and the operator's personal agents file (`agents/` in Tagma's data directory) — to agents too. The operator alone, or an agent on his word, writes the personal floor for Tagma, so an agent he wrote is started by his agent with no second act.
- the project's `.agents` file, an app agent and a plugin agent — to the operator only. Repository, app and plugin authors write them, not the operator; an agent receives such a type once the operator opens it with an `{type, to: "agents"}` record.

An `agent.offered` record overrides origin in both directions.

A type that exists but is not offered to the agent is not "unknown": `resolve` answers `ThreadTypeWithheld` with a reason and a way out, and the core refuses `type-withheld` with that way out instead of the code table. Otherwise the `unknown-type` refusal would send the caller to the agent library, where the type stands, and the refusal's way out would stay invisible.
