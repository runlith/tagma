---
id: 01a1a33d-a562-72c1-b6d5-84be2d5b8f32
title: The running record read keeps the build it started from while it reads the log tail
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2ba-87df-748d-bc94-66317e1c6f98",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1a2da-db0b-796b-a782-2f2ff861daa5
---
`runningRecord` read `running` again after waiting for the log tail, so a settle in between ended it with a defect, or joined a newer build's record to the old tail. It now answers from the build it saw before the wait. No test: the tail read goes through the layer's own FileSystem, so a deterministic stall between the two reads would need a test-only door.