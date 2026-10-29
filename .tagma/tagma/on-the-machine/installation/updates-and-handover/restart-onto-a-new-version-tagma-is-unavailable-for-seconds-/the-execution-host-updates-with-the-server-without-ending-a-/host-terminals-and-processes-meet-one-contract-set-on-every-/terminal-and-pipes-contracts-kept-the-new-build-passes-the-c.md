---
id: 01a127af-c14d-7f11-84ef-57d12da7ead3
title: "Terminal and pipes contracts kept: the new build passes the contract set on macOS"
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4ec70308b97d
  - kind: implements
    to: 01a127ad-cc0d-7a03-b77a-95f17df613b0
  - kind: waits-on
    to: 01a1271e-2479-7971-9b0c-4ec70308b97d
  - kind: waits-on
    to: 01a127af-c14d-7f11-84ef-57d03a807a7c
---
Before moving to logic recovery and merging the line, prove macOS terminal and pipes parity per the terminal-quality spec [[7df613b0]]. Carry the kept contracts of the removed `native/Pty.itest.ts` and `PipeProcess.itest.ts` into one public adapter set; keep the assertions of current host tests, changing the owners' assembly. An assertion changes only in the spec's three cases (step dictionary, a pinned contract violation, the intentional [[d86d6647]] change), each named. The old implementation is the lower bound: contracts it violated are met by the new one, and the report names them as fixed. Fix the three current `nativeLaunch.itest.ts` falls at the root, without weakening acceptance. The set guards I/O with backpressure, Ctrl-C to the foreground work, resize, EOF/hang-up, reading to the end after exit, exact environment/cwd and resource inheritance, descendants, status with cost, and freeing. Each check runs separately within a minute, with no wide fanout. The old build no longer starts: contracts and measurements run only on the new one. Narrow measurements of the new build — PTY big-output throughput, echo delay, stdout and stdin throughput over pipes — with conditions, sample counts, and limits; already recorded old-build numbers serve as a landmark, a divergence from them is investigated in the new one. Done when the contracts pass, no check from the removed files is lost, and an independent review is taken apart.
