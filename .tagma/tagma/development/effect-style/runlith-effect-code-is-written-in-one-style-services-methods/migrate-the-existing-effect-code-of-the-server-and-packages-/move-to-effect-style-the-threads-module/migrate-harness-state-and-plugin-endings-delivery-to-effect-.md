---
id: 01a13f4c-4da3-7b27-872f-65f9775fc4b2
title: Migrate harness state and plugin endings delivery to Effect make
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13dcf-d796-7317-8b62-3cac8ce5923e",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/state.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/tagmaAppEndings.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/harness/engine.ts
    symbol: threadEngineLayer
---
Remove the SubAgentDepths, EngineStates and EndingDelivery classes, keeping state projections and at-least-once plugin ending delivery; take dependencies from tags. Move their assembly into threadEngineLayer. Verify types, a narrow integration run, effect-style and an independent review; the remaining harness mechanisms stay in the parent task.
