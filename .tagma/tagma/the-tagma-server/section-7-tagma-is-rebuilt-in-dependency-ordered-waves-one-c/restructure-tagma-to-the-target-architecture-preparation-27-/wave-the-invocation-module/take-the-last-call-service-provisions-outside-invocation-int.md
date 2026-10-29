---
id: 01a0ee1e-8d01-7f6e-877e-493cc4997cb3
title: "Take the last call-service provisions outside invocation into it: routing's CurrentGraph re-scoping and the touch brief's session signing"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ef6c-0083-7c6e-8135-d4f1a35b689d",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/touchRule.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/routing.ts
    symbol: withBlockGraph
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/routing.ts
    symbol: withProjectGraph
---
The `call-services` inspection of [[4657a163]] finds three provisions outside `invocation` that stood before the single assembly landed:

- `graph/serving/routing.ts#withProjectGraph` and `#withBlockGraph` re-provide `CurrentGraph` when an act names another project's graph or block mid-call.
- `native-harness/capabilities/touchRule.ts#touchRule` provides `SignedSession` around the touch brief the kernel reads after a tool edit, so `Touches.record` and its unit write sign as the thread.

Each is debt of the rule's enforcement at merge. Done when the inspection with the merge list's params reads 0 violations over the reach: the re-scoped graph comes from invocation's assembly (the workspace lifetime resolved per named project), and the touch brief runs as an invocation act or takes its session as an argument.