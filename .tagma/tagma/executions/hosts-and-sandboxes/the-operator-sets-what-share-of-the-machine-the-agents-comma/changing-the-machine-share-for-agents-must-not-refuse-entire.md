---
id: 01a14c37-8df6-78fc-8cc0-19411f46787b
title: Changing the machine share for agents must not refuse entirely because of one running command
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c14-6895-75c6-80f2-47c3c1a7947b
sources:
  - kind: file
    ref: apps/tagma/server/src/power/pace.ts
  - kind: file
    ref: packages/execution-host/src/Pacing.ts
---
The Low hint of `power.agentWork` promises the level reaches commands started after the choice. `Pacing.change` refuses the whole change if even one running command cannot be moved (on macOS `Tempo.directions` moves only between the starting level and Lowest); the host level stays previous, new commands start on it, and `power/pace.ts` repeats only on failure. The conclusion from reading the code needs reproducing first.
