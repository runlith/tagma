---
id: 01a11401-0fc2-7ae2-9e45-3daa8e42577c
title: "Move Claude hosted-thread questions to native owners: confirmation and awaiting in ThreadHosting; delete the ACP consent loop, the facet question mirror and the second recap"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11401-6572-7d04-aed3-c061410c997b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a113ff-0d62-74ec-ae7c-e9127c54d3ed
---
Do everything spec [[7c54d3ed|hosted thread via native owners]] describes. Start at `ThreadHosting.executed` (the `ask` verdict) and `questioned` in `packages/agent/src/thread/run/ThreadHosting.ts`, then the `call_hosted_tool` wire, the runner (`permit.ts`, `bridge.ts`, `door.ts`), the driver (`questions.ts`, `driver.ts`), `hostedQuestions.ts`, recap in `turning.ts`/`facets.ts`, the migration step.

Done when the `ThreadHosting` contract tests and the spec's “Verification” section system tests pass, the code search is clean, and notes 8e0f35a1, d0810682, e47bd3fc are rewritten.
