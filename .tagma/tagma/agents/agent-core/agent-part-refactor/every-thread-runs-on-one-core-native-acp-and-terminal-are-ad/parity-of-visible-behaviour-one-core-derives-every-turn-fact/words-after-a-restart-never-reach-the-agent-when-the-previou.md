---
id: 01a14de4-2529-7ee2-b31a-10f4397b69e8
title: Words after a restart never reach the agent when the previous turn's prompt was durable but never reached bytes before the server stopped
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae6-7c7d-9cc2-edc404b6eb7f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c18-c833-7d88-b3bd-66eb312abbba
  - kind: discovered-from
    to: 01a14d27-43b7-7f10-8069-125e71bd222c
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/attendance.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/endings.ts
---
Observed (one `protocolStops.stest.ts` run, scripted agent, server stopped right after the core opened the turn): the agent heard `initialize`, `session/new`, `session/set_mode` but never heard `session/prompt` for the previous turn. After restart it heard `session/cancel`. After 30 s the session facet is `ended`, `execution: null`, the protocol row with no turns and no requests, and the next words' run stays `running` with not a single frame to the agent.

Assumption, unverified: `Recovered` makes a prompt with no receipt uncertain, `unconfirmed` closes the process on grace, and the session ends; the next words' run, launched before that, lands in neither the session end's `unlaunched` nor a new launch. Start by reproducing: let the core open a turn, close the driver scope before the prompt bytes reach stdin, then words on a new driver. Proof — a system test where the next words reach the agent or the run ends with the words returned.
