---
id: 01a19936-6251-7bd4-801d-8abdf978d418
title: Report and settle a headless e2e hang instead of leaving its worker alive
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19936-99ee-751b-8cb6-b0f991b1ee5e",
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a1991b-afdd-734c-83ee-cd5227668518
---
The earlier terminal e2e run was stopped after 298 seconds while cleanup was still in progress. A subsequent run with the current `world.op` cleanup settled at the three-minute guard with exit 1 and a report containing one failed test; the worker hang did not recur. That run's artifact directory contained the scenario's earlier `handoff.png` but no failure screenshot, console log, or trace, and the output named no `Artifacts:` directory; both cleanup operations logged an interrupted HTTP 503. The missing failure artifacts are observed separately from the non-reproduced worker hang.