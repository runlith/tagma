---
id: 01a188b7-9fec-7206-8e38-57c5124b49c0
title: Restart rig with a new shape step while the client stands in a big thread, and one sample of frame time against thread length
ord: 8
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/restartProbe.ts
---
Two proofs the spec owes: on the restart rig (`composition/testing/restartProbe.ts`, spec 212d752c), a restart onto a build carrying a new shape step while the client stands in a big lagging thread never lengthens the window beyond the same restart in a small thread, within a declared tolerance; and a feed frame of a lagging thread arrives in the current shape in a time that does not grow with thread length — measured as one sample on this machine, labelled as such, never an absolute-seconds assertion.