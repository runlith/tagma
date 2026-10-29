---
id: 01a0de31-d9fa-7e19-b286-e94d91290f2c
title: Every Tagma operation's own span heads a judged unit, so a slow or failed operation keeps its subtree against its own name
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de28-0af5-735b-a8eb-bade04dc0b11",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c61d-e8dd-7f53-9b0f-237c3f739edc
sources:
  - kind: file
    ref: packages/performance/src/PerformanceTracer.ts
  - kind: symbol
    ref: apps/tagma/server/src/composition/runtime.ts
    symbol: performanceLayer
---
Reflection 3f739edc: 35 `delete_thread` completions in one hour (233 s, one failure, 31 above 4 s) left no span to break down. Since the judged units (e0e482f901) an operation run from a native tool call is judged only through its `agent.tool-call` head, which is slow against every tool's p99, and one run over HTTP sits in its root's windows, where a root that outlives the first window is never kept for slowness — so a slow operation keeps nothing on either road unless it failed or stalled.

**Do:** the tracer takes, from the product that mounts it, the span names that head a judged unit; the server names its operation ids, so an operation's own span is judged against its own name's p99 and keeps its subtree when it failed, ran slow or stalled.

**Out of this task:** a reading of how many of a name's units were kept or dropped (e2fb8cf4) — the sampler's tally still has no way out.

**Done when:** an operation span under a tool call and under an HTTP root is judged on its own; the tracer's claims and the performance skill say so.