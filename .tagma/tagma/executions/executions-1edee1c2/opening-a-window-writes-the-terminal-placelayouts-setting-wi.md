---
id: 01a150a3-4438-72b6-a0af-8943c24a62af
title: Opening a window writes the `terminal.placeLayouts` setting with an empty value though the user changed nothing
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a150a3-6b1d-7521-98c5-0ed3eb3d9f64",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15099-cd9e-701b-a6c4-f1832352d112
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/places/State.svelte.ts
---
Every thread opening makes the app send `write_setting_layer` with `{"scope":"project","key":"terminal.placeLayouts","value":{"places":{}}}` — a write with no user gesture and no change. Find what starts the layout persist on launch, and write only a real layout change; proof is an opening that sends no `write_setting_layer`.
