---
id: 01a140af-059b-7ec9-b68e-1f138d599a36
title: Restart onto the fixed build is refused by the same broken host
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "build.json: outcome landed, restartRefused: the execution host could not prepare its successor (holder): lost: the holder sent a frame this logic cannot read — the recovery path depends on the broken component",
    "command": "tagma build --head (then: restart) on 103a0b2374",
    "expected": "The build with the fix comes up, the host is replaced by the new one"
  }
---
Filed from project `runlith`.
