---
id: 01a11288-8955-7557-b5cd-3671cecce2a0
title: Remove the old ~/.tagma/traces directory cleanup from the activity module after the activity release has reached the installs
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a11269-a3ce-7ee4-b5ba-178403b34468
sources:
  - kind: file
    ref: apps/tagma/server/src/activity/layer.ts
---
`activity/layer.ts` deletes `<dataPath>/traces` on every start — a one-time data migration living as code. Deletion runs async in the FS thread pool, after the first time — a cheap absence check. Once the first release with activity reaches the installs, delete this call. Done when `layer.ts` holds no mention of `traces` and `runtime.itest` no longer checks it.
