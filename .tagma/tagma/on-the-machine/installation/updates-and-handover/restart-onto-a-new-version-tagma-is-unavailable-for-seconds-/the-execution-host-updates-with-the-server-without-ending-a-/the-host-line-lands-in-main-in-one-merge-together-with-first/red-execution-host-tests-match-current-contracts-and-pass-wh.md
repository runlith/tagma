---
id: 01a12ae4-d3d1-7559-9cc9-0d5838720114
title: Red execution-host tests match current contracts and pass whole
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12735-55f2-75e0-95d7-53127c1b6811
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
---
Fix five red execution-host files without changing the working server and its host. CommandDeadline and CommandLifetime are outside this work.

Changes landed in `bbdeed2188` and `4e7471897f`; the terminal trap readiness was fixed earlier in `ce9d12ab95`.

| File in packages/execution-host/src | Root and change | Full file run |
| --- | --- | --- |
| ExecutionTerminal.itest.ts | Started did not confirm trap setup; the shell prints ARMED after the trap, the test waits for the marker before SIGTERM. On teardown the holder layer closed with a remaining execution record: holder.rs:529 restarted a relay that could no longer hand control to the closed socketpair. The finalizer of its own scope now calls HostLifecycle.shutdown before closing the layer and checks ShutdownComplete, including on test-body failure. | 7/7, 11.77 s; no relay Broken pipe messages. |
| composition/testing/presentation.itest.ts | Checking a live descendant after nativeExit contradicted host finalization: registry/work.ts:182 → ExecutionStop.ts:192 → ptyLaunch.ts:186 ends the group remainder. The wait for an intermediate running state is removed; the InputEnded checks for PTY and the taken-input checks with exact output for pipes are kept. | 7/7. |
| composition/testing/receiptCapacity.itest.ts | With fd exhausted, macOS recvmsg sometimes answered EMSGSIZE. native/src/channel.rs:75 did not count it as exhaustion, so the client lost the channel and the registry returned SpawnFailed. EMSGSIZE now goes down the SCM_RIGHTS refusal road: the payload reads without fd, the start rolls back, the answer is CapacityExceeded. Falls reproduced before the fix; five separate full runs green after it. | 1/1 in each of five runs. |
| generation.test.ts | The test encoded the old wire's number with the current schema HostFrame; packages/executions/src/protocol/wire.ts:62,476 takes only the current form. The read-by-an-old-client check is removed; generation and typed-refusal checks kept. | 7/7. |
| hostConformance.itest.ts | A writer.lock present is not a live claim: native/holder/src/macos/mod.rs:169–180 creates the file and separately takes the flock. The file-absence check is removed; non-zero exit of an invalid host and no published registration or DB are kept. | 8/8. |

Both native builds passed with cargo -j 1. Checks ran one file at a time on own fixtures with a 60000 ms limit. The last standard `bun run typecheck` failed on another writer's change in shellHostDeath.itest.ts:196 (TS18048) and :200 (TS2345); the files of this task show no diagnostics. Linux and Windows unverified. No separate review run: the architect is assigned to run it.
