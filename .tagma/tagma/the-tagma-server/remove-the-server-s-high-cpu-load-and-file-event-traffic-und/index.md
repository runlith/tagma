---
id: 01a13f3a-f78e-7608-8113-58e0ec2af22f
title: Remove the server's high CPU load and file-event traffic under parallel agents
ord: 122
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523f-7ee2-9537-e8014a4925bd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b76-3d46-78eb-b352-1c34449dfe0d
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/change-record/ignoredInputs.itest.ts
---
Measure the server's current CPU share and background file-event traffic, find the hottest path on saved profiles and the watch → rescan → recompute chain. Fix the clear cause at its owner without stopping the server; confirm with before/after measurement. The operator's requirement is total machine load below 30%; name every unproven or unreachable-in-a-running-build condition explicitly.

Delivery `058926e55a` and `0ba9075449`: Holdings cuts ignored observer paths with no standing rows and no tracked changes before workingAt/prepare/fold; real outside holdings stay. Explicit preview/rollback reads the required input and settled records. Early check-ignore gets only the remainder after rows/status, late check-ignore only not-yet-checked readable outside candidates; no process is spawned on an ordinary tracked path. Probe time comes from the Clock. The main review and two lenses ran; the confirmed historical-restore and staged-rename-source regressions closed red→green.

Three matched runs of one probe per source, no checkout rollback: an ordinary recorded/tracked path spawned 3 Git processes before `058926e55a`, 4 on it, and 3 again after the fix; the ignored directory stayed 3/3/3, but the returned probe count changed 1/0/0. In this reading Git.objects is never called; every Git.run goes through spawnGit. The narrow public-judged and CheckoutRows.onMark scenario proved ignored-directory lstat 1→0 and 2→0 respectively, unread fold 1→0, observer folds 3→1. Wall samples depended on load and prove no stable speedup. The measurer and loader stay in this session's scratch as ignored-spawn-bench.ts and ignored-spawn-loader.ts; the measurer input ran inside the workspace with pinned dependencies, the two earlier states' sources substituted in memory.

Last narrow checks: ignored/ordinary — 2 pass, 12 assertions; historical restore separately — 1 pass, 5 assertions, 4705.08 ms case and 10.10 s file. It runs through it.live; it used to time out at 10000 ms, whose cause is undetermined, and no link to TestClock is confirmed. A single final `bun check -p apps/tagma/server` finished in 122.43 s with seven errors in three foreign graphFiles/graphTools/voice files; the delivery has no errors. Total machine load below 30% and the CPU of the updated running build remain unproven; the agent never restarted the server. Empty Git-refusal text is split into [[97b0bee9|a separate task]].
