---
id: 01a14b4f-e30c-7b63-a1ff-94f350053c30
title: Keep list shape in tool input and serve the hosted refusal the unexpanded tool's schema
ord: 64
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14b4e-2a5e-7a49-be6a-5060ae29dc59",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14a93-e4e4-7320-aa3e-811e651b99ee
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/native-harness/hostedCalls.itest.ts
  - kind: file
    ref: packages/agent/package.json
  - kind: file
    ref: packages/agent/src/agent/modelDialect.test.ts
  - kind: file
    ref: packages/agent/src/agent/modelDialect.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/hostedCalls.test.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/hostedCalls.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/hostedTools.ts
  - kind: file
    ref: packages/agent/src/thread/run/hostedRecords.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
---
Fixed [[651b99ee|the list-shape loss in a tool input]]: modelDialect wrapped a JSON array text's single element, turning it into one address. Now such text reads as an array; an ordinary scalar keeps its single-element reading, and a declared line stays a line. The current SDK/MCP bridge passes the input without stringify; what first emitted a line before the bridge's input, the reflection itself does not prove. A hosted refusal over an unexpanded deferred tool's arguments carries the body shape, the field, the expected shape, and the schema. Code: `3ab7218a95`; the extra history walk for refusal data found by the single Sol xhigh review removed in `0a2c7311d8`: a successful call does not compute that data. Both defects first reproduced red in checks; the final 27 decoder/hosting unit checks, the new shared ThreadHosting contract on SQLite, and `bun run tagma:typecheck` passed. The reflection is answered by the commit. The operator's server was not restarted; a live Claude Agent SDK run with a model after the operator loads the new code was not verified.
