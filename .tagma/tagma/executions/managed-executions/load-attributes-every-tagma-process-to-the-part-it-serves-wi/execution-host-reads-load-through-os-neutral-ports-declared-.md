---
id: 01a1924a-4293-7875-8a42-4e1b78d182eb
title: "Execution host reads Load through OS-neutral ports: declared parts, on-behalf-of, container counters, refused processes on demand"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1924b-d739-788a-a166-242a92649f20",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a19236-e2ce-7b34-8015-7c0e70df78a3
sources:
  - kind: dir
    ref: packages/execution-host/src
  - kind: file
    ref: packages/executions/src/protocol/evidence.ts
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
---
Steps 1 and 3 of the spec and its host-protocol contract: the Load protocol takes declared parts with live replacement and the `others` demand; placement adds parts and on-behalf-of; accounting takes an execution container counter; `.app` grouping, the responsible link, the `ps` fallback and birth resolution move into the macOS adapter; the core loses every OS name. The protocol lands first, since the rows task builds on it.