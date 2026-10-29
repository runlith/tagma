---
id: 01a129ae-6dfd-774f-8185-abe3e3159608
title: Check the line host server changes in a bounded scope
ord: 16
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: dir
    ref: apps/tagma/server/src
---
Check the line's server-side changes in a bounded scope and classify errors by main merge-base, fixing the line's own at the owner without touching peers' current zones. Result: the full server tsconfig green — 5546 files, exit 0, native TypeScript 7, compiler 27.742 s; command `GOMAXPROCS=3 node_modules/typescript-native/bin/tsc --noEmit --incremental false --composite false --extendedDiagnostics -p apps/tagma/server/tsconfig.json`. Three fixture errors fixed in 9b08d037a8; 35 ambient diagnostics caused by the new adapter → host-runtime link removed by [[dd9dea8d|moving the shared boot error]] in e8b7a9e1f0. No main errors in the final check. Host refusals 3/3, source-host cleanup 1/1; forbidden zones untouched. Deliveries went via direct git commits because of the [[56e7305b|submit_work defect]], without disabling hooks.
