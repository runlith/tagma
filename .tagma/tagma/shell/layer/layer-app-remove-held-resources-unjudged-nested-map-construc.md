---
id: 01a0e99a-95c3-7edf-912d-e1c574d935d7
title: "Layer app: remove held-resources' unjudged nested Map construction"
ord: 40
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/layer/src/App.ts
---
`packages/layer/src/App.ts` currently constructs `new Map()` in `this.open.set(rung.name, …)` near line 192; the inspection cannot infer its nested value type and reports unjudged. At the layer package's wave, retain the nested Map type at its construction or extend contextual type facts at the producer, and prove the site judged before `held-resources` reaches gate.