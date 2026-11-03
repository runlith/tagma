---
id: 01a1a256-eb7a-74cc-a836-099a8a8466a2
title: Bound release downloads and inspect the real archive footprint
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a256-5805-7d61-ae3c-633b6fad9951",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a13283-fc95-76c8-a601-3f5eac2d9a04
---
Reject a release download when its bytes exceed the declared size or finish short, and inspect the archive's admitted entries and real extraction footprint before unpacking so the release runner can preflight the required space.