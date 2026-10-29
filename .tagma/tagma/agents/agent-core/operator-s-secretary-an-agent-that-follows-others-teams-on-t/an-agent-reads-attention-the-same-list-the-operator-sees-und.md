---
id: 01a16449-f3a3-7a52-9c4a-9052b32812f7
title: An agent reads Attention — the same list the operator sees under the bell
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1644a-51d2-73d9-a751-0fee4cd9e4aa",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/attention.ts
    symbol: ATTENTION_OPERATIONS
---
`read_attention` today belongs to the operator only: `callers: 'operator'` and no tool. An agent gets it as a deferred tool, a CLI thread as an operation through MCP Tagma, with the same answer. An agent reading a thread does not mark it seen: only the operator's read does.
