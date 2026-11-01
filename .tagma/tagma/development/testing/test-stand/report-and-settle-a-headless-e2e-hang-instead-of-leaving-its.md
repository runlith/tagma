---
id: 01a19936-6251-7bd4-801d-8abdf978d418
title: Report and settle a headless e2e hang instead of leaving its worker alive
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19917-0235-76be-a812-9672f9ae9798",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1991b-afdd-734c-83ee-cd5227668518
---
A terminal e2e with the current `world.op` cleanup reached the three-minute guard while a PTY lane was open, lost its execution host, and continued logging unavailable-host retries without a verdict. A second run settled at the guard but its artifact directory lacked the failure screenshot, console log, and trace. Investigate the guard, failure-artifact and finalization boundary, then preserve failure evidence and settle the worker without changing the guard duration.