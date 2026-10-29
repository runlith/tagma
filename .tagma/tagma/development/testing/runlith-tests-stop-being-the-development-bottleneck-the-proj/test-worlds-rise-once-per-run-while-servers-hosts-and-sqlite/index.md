---
id: 01a16fbd-b4fa-7f3d-8686-f613ebeb65a0
title: Test worlds rise once per run, while servers, hosts, and SQLite children live on the worker, not the file
ord: 40
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b701ff15f336
  - kind: relates
    to: 01a16fbd-b4fa-7f3d-8686-f6122255f40d
---
Test-raising bun processes are 28% of the heavy slice's CPU, and parallelism adds 78% CPU over a single-process run of the same files: every worker rebuilds DoorFixture, EnsureServer, TerminalFixture, HostBundle, and loads modules. World-build waiting is the largest wall share of the slowest files (absorbCheckout, mergeTakesBase, hostedReveals, ensureServer, commitGate, commandOutcome, execution-host logicReturn and succession). A world builds once per run and copies into workers; one worker's server, host, and SQLite children serve all its files; product telemetry switched off where it is not the test's subject. Acceptance: the same slice on 10 workers near single-process CPU (248 → ~150 s), several times fewer bun starts, test isolation no weaker.
