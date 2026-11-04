---
id: 01a1a83d-f5be-74d5-8aa8-06b53d10c144
title: Browser launch composition · substrate
ord: 35
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "current.ts"
      }
    ],
    "id": "chromium-launch-platform",
    "kind": "substrate"
  }
edges:
  - kind: imports
    to: 01a1a83d-f5b5-71c2-b345-4b5f6df10877
  - kind: imports
    to: 01a1a83d-f5bb-7757-9552-28547a5fba4d
sources:
  - kind: dir
    ref: packages/chrome-for-testing/src/launch/platform
---
Browser process owners take the launch environment of the executing machine from one composition. It selects the Linux adapter or the portable environment and leaves each browser owner responsible for its process and returned refusal.