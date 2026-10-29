---
id: 01a13f62-441e-7be2-9727-261ae6c00a32
title: Bring the Agents' share (Full · Low · Lowest) switch back to the Load panel header
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f49-98e0-78b6-acd4-84ba6a990ec9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11b5e-918b-7fdb-80da-5009552ae607
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/LoadPanel.svelte
---
The operator wants to change the machine share for agent commands quickly right in the Load panel; the panel rework moved the switch into settings. The server didn't change: the `pace.subscribe` stream and the `power.agentWork` setting are alive, only the client returns — the `Pace` service next to `Awake` in `features/power`, the control in `app/chrome`, the place in the `LoadPanel` header.

Done when the switch stands in the header, writes the setting and shows the applied state; the app typecheck passes.
