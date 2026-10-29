---
id: 01a12ada-0f87-713a-a04d-8a60f48059a3
title: Fix parity successor and host death and telemetry checks
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12a53-cf8c-7b44-8069-9091a0ad97ee
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/parityWorld.ts
  - kind: file
    ref: packages/execution-host/src/hostTelemetry.itest.ts
  - kind: file
    ref: packages/execution-host/src/shellHostDeath.itest.ts
---
Three red files fixed in 81f5babd985fdc593f75e185dcd3c8834a1b2c6; all pass whole. The production driver unchanged, refusal boundaries not weakened. Review10 fixed in f4410f73c5e1329a15622b80ef4eaf743cab6f49: shellHostDeath moved byte-for-byte into the system layer (.stest.ts), since every case destroys its own real host. Three contracts kept; a new full run 3/3, 7 assertions, 9.37 s in a 60 s budget, sources carried with the file.

| File | Proven root | Change | Commit | Full run |
| --- | --- | --- | --- | --- |
| apps/tagma/server/src/composition/testing/threads/parity.stest.ts and parityWorld.ts | The old successor createRuntime got no hostSourcePath/placedHost; runtime.ts:368–380 derived source=undefined, executions/assembly.ts:222–227 — Unoffered, then NoBundle/WireUnavailable. The old crash branch closed runtime/SQLite before closeStack, though AgentHarness/SessionDriver finalizers write through it. | HostManagement hands the confirmed digest of the single bundle; the successor gets source and Standing placement. For the in-process crash scenario, persisted-lease owners move to the departed, handed_over_at=null; old finalizers by owner predicate can no longer record those runs' handover. Stack and graph owners close before SQLite. Four joint restarts and the whole matrix kept. | 81f5babd98 | 60/60, 72 assertions, 45.23 s |
| packages/execution-host/src/shellHostDeath.itest.ts | Old rows 187–212 declared ToolDisplay.failed, which the ToolAnswer contract has no field for, and turned a typed failure into value/display undefined. killHost killed only the holder, leaving the logic running; that is holder loss, not the whole host death. | The helper uses Tool/toolExecute and keeps Effect.result; verdict unknown, typed PlatformError/BadResource/result at the companion, and scope completion are checked. Holder and its measured logic child die; no fixed 250 ms sleeps, the timeout name replaced with real waitMs/lifeMs. The result-wait timer is cleared. | 81f5babd98 | 3/3, 7 assertions, 9.69 s |
| packages/execution-host/src/hostTelemetry.itest.ts | The old script:327 compared ancestry evidence of three different live process populations. An extra fall: a non-SQLite file on the performance path did not hold the refusal — SegmentRing.open:408–413 recreated the ring. | Byte/result/refusal/ending and required leader/work coverage, full cleanup, no residual/unverifiable are compared. A real unreachable store is a mode-000 catalog; got SegmentOpenFailed/EACCES on rm, the directory left empty. Mode restored by the scope finalizer after the worker stops. Span/counter and saturated-store checks kept. | 81f5babd98 | 4/4, 36 assertions, 18.32 s |

One parity bundle is created by the initial world; the new runtime gets the same digest through the announced placement, no second producer run. Crash in this file is a model of abandoned persisted leases on in-process owners, not SIGKILL of a separate server process; graceful/crash control differs by handover marker and owner predicates. A real server restart is checked by a separate line stand, not run here. 45.23 s is one macOS sample in a 60 s budget, not a universal speed and not proof of the old under-45 s goal.

The shell test gained an honest test dependency on @runlith/agent in package/lock and an imports-tests relation host-composition→agent: the existing public door and verdict are used, the handwritten Tool slice and cast removed. No open test-only entries added. Full server and execution-host native-tsc exit 0; formatting and diff check clean. Checks ran on the shared working tree; some neighboring commits moved, each delivery and check area named separately.

Pre-green telemetry after the ancestry fix showed a fixture-obstruction instead: `Expected:true, Received:false` for performance.isFile; the new sample measured `SegmentOpenFailed: EACCES: permission denied, rm …/performance` instead. The original red parity and shell are kept in line-initial-192.log and 117.log; telemetry in 100.log. A direct git commit limited to six paths used per the shared brief because of the recorded [[56e7305b|submit_work defect]], hooks not disabled. Foreign unfinished files not included; read_changes after commit shows 0 own held paths.
