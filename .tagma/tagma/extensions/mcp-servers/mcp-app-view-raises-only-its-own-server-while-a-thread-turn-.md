---
id: 01a123cd-e780-7856-8bd8-ae613a504334
title: MCP App view raises only its own server, while a thread turn with the mcp capability raises every project server
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1236d-51e7-7552-ad52-dbc10c2dbada
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/serverPool.ts
---
When an old thread with views opens, the project pool used to raise every declared server, although views need only their own. Now the project pool remembers a narrowed set (`narrowed`): a view request adds its own server there and reconciles the pool with it alone. The request goes to the pool at once only when reconciliation with its server already finished (`reached`); otherwise it waits for its own reconciliation, so two simultaneous views do not catch the server still undeclared. `reconcile(projectId)` from a thread turn lifts the narrowing for good. Editing declarations keeps whatever narrowing already stands; when there is no pool yet, the edit opens it whole, as before. So a server added to a narrowed pool stays `pending` until a view or a thread turn asks for it.
