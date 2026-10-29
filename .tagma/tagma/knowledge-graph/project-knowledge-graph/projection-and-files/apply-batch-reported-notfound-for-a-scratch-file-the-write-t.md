---
id: 01a148b4-5f72-7889-8164-0fbdda6e4022
title: apply_batch reported NotFound for a scratch file the write tool had just created in the same step
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "apply_batch refused batch-source NotFound; the file existed on disk a moment later and the unchanged retry applied. Cost: one extra call and a shell check.",
    "command": "write(path=<scratch>/graph/followups.json) then apply_batch(file=<same path>) sent in one parallel step",
    "expected": "apply_batch reads the document the write created, or the parallel step orders the write first"
  }
---
Filed from project `runlith`.