---
id: 01a127b8-b65b-7db7-83b0-99bfc70b74d5
title: "Prompts for the \"home and place\" model: the Tagma agent definition and tool descriptions stop promising one project"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127b8-f970-7e4c-a8e2-16497df3cda5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/tagma/identity.ts
---
The stage 1–2 behavior stands; the prompts still say "You work ONE project" and "a thread's calls act in its own project". Rewrite for the spec's model: the thread has one home, each act is addressed to a place (`project` for graph and thread acts, the path for file ones, `workdir` for commands, an explicit place or the single checkout for `submit_work`, `spawn_agent project`); on `law-unread` the act is not executed: read the delivered law of the place and retry the call; the first non-mutating file read passes without this refusal.

Start with `native-harness/agents/tagma/identity.ts`, then the operation descriptions and doctrine promising one project (grep `own project`, `ONE project`, `current project`, `foreign-project`). Write under rules `d82432e6` (only what exists) and `d1436c13` (compact); verify texts against the operations' current code, not the spec.

Done: the texts match the operations' code; the refusals the prompt references exist. No tests on text.
