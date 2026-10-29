---
id: 01a16fbd-b534-7075-a5a6-45600da4838c
title: execution-host, agent-tools, and performance tests wait on events and stop depending on machine load
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16fbe-75e3-7f19-8568-ed3a829a1d7f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
  - kind: relates
    to: 01a16fbd-b4fa-7f3d-8686-f6122255f40d
---
Remove wall-clock waits and extra native setups in execution-host hostProcess, ExecutionRuntime, logicReturn, succession, capacity, lateLimits; agent-tools bash and commandWork — keeping public contracts and verifying seeds 1–3 under load.

Done: state, byte, capture-window, handoff, and child-start waits moved to owner events; duplicate setups merged. ExecutionRuntime: 43→38 tests, 50→38 child processes. Clean restart/backoff/rejected-bundle policy verified through the public Rust holder::run with a virtual Platform; real exec, fd/table, StoreAhead recovery, and the indivisible native PREPARE timeout kept. Fixed the unreadable-phase defect at waitMs=0 in bash and the saturated-host census disagreement. Deliveries: b4659295d6, 2e4a5b27ca, 4a9b5e64aa, fb0cecfb0c.

Every touched file passed seeds 1–3 separately; package typechecks and native tests green. Final execution-host six: 78/78, 437 assertions, residue 0, 129.378 s wall / 18.182 s CPU, one worker, end load 28.81. Baseline: 87 pass / 1 fail, 126.6 s / 18.8 s, one worker under shifting load. These are samples under different conditions and prove no joint speedup factor; per-file and additional side-by-side runs are in the ledger `x10/w-packages.tsv` in the [[01a16a94-8d3a-7610-abd9-8503665bc41f|launching thread]]'s scratch. Separate agent-tools samples: bash 11.2 s/4.455 s → 3.088 s/3.025 s; commandWork 31.2 s/10.498 s → 1.141 s/1.082 s. Independent review of execution-host found one P2 census, fixed with a causal red→green; agent-tools and performance verified independently in their deliveries. Post-exit covered-process semantics from the [[2568a1b2|separate default-deadline task]] are not declared fixed: the red seen here predated the first program-rule binding.
