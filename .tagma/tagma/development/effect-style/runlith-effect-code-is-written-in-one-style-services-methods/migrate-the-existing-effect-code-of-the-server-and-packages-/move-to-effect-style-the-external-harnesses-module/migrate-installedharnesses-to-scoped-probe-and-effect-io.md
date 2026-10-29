---
id: 01a13fe3-90d8-702f-abf2-07f11526386b
title: Migrate InstalledHarnesses to scoped probe and Effect IO
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
  - kind: implements
    to: 01a13bf9-2f15-7d9a-aca2-21a02aa569ba
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/installed.itest.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/birth/installed.ts
---
The second part of birth/: the CLI --version probe belongs to a scope, interruption and timeout kill and await the child process; realPath and runtime inside the service go through FileSystem; native async stat preserves the cache key's fractional mtimeMs. Existing spans stay. Keep single-flight, the failed-probe cache by file/PATH, fallback after a slow candidate, unreadable and refresh from the [[2aa569ba|CLI discovery spec]]. Update the direct layers/tests with no system build; proof is narrow lifecycle and discovery integration tests, one package typecheck, effect-style 0 and check_law. Metrics, diff and one review round go to the parent before landing.

Delivery `c256919a71`: the probe process is killed and reaped before answering interrupt/timeout, three permits are held until reap, async fingerprint duplicates no probe for concurrent readers. Cancellation proven red→green; installed — five scenarios, homes — one, the extended cache scenario separately 1/7. Production installed 205→232, with wiring +28 nonempty lines total (+76/−48), effect-style 0→0, check_law clean, three reviews with no findings. One package typecheck: 10 external errors in graph/orientation/map.test.ts, no errors in the changed files; the later logging-recovery and assertions were not separately typechecked under the limit. The exact native stat and two best-effort recoveries are declared in the note and enforcement; the parent accepted the delivery.
