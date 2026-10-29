---
id: 01a126b9-6a5d-780b-8049-421f153b89de
title: Restart record by phases and a rig measuring the window on client clocks
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1267b-ea09-7fb8-9262-45fa444a045d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79e7212d752c
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/restart.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/restartRig.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/record.ts
---
One restart record per restart at `installation/process`: phases as data (the ones `composition/phase.ts` already measures), predecessor phases handed to the successor, the record read by `tagma status` and the machine-state operation, the server takes the window length from the client. And a rig — a system test on its own server instance measuring the window on a test client's clocks over two datasets. Start with `composition/phase.ts`, `composition/server.ts`, `installation/process/succession.ts`. Done when the rig passes and cites the current window as a sample, and the record holds the server-interval phases.

Delivered: `fe292ba265`, store-opening port — `a702d2ec30`. Protocol rig on M2 Max arm64/32 GiB, 3 graphs and 24 threads: windows 1.874 / 2.653 / 2.169 s (short history, 256 messages in the rest of the threads, big open thread); one sample each, system part 32 s. Comparison returns as a measurement before window reduction; browser reload and rollout-file reads unproven. Record and its IO refusals, process and client-build switch, candidate cancel checked; the last shared typecheck stopped on parallel `packages/agent`/`agent-tools` changes after an earlier clean run. One Sol xhigh + Opus high round done, confirmed findings fixed.
