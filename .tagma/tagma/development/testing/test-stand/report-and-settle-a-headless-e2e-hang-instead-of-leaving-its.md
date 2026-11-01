---
id: 01a19936-6251-7bd4-801d-8abdf978d418
title: Report and settle a headless e2e hang instead of leaving its worker alive
ord: 32
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1991b-afdd-734c-83ee-cd5227668518
---
A headless terminal e2e reaches the three-minute hang guard, loses its execution host, and keeps logging unavailable-host retries without a test verdict or failure artifacts; the outer command had to be stopped after 298 seconds and reported zero files and zero tests. Investigate the guard and world finalization boundary, then preserve the failed-test evidence and settle the worker without changing the guard duration.