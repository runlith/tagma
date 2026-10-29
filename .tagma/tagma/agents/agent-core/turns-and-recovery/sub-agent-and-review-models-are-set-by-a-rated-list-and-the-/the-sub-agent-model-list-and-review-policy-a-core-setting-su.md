---
id: 01a150e6-3b12-7a97-bfba-b23581d1cf66
title: "The sub-agent model list and review policy — a core setting: supplied lines, layers, the spawn_agent description, and change delivery"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a150e6-76e7-7229-9c5f-35281cc64a6a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
sources:
  - kind: dir
    ref: packages/agent/src/collaboration
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
---
Server and core part of spec [[ac67b9de]]: the list-line schema and the review policy instead of `agent.modelGuidance`, supplied Anthropic/OpenAI lines with visibility by connected accounts, machine → project → thread merging, included lines and instruction in the `spawn_agent.model` description, policy line on working threads' next step (the `delegationRule` mechanism), `read_models` as an available catalog, refusal of an unknown id with the nearest. Start from `modelMenu.ts`, `CollaborationTools.ts`, `threads/contract/wire/settings.ts`, `native-harness/turns/delegationRule.ts`. Proof: contract tests of description assembly, layer merging, and delivery; typecheck of affected packages; commit.
