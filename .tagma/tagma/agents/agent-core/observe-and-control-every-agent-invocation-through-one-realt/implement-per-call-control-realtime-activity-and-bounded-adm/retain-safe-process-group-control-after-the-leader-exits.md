---
id: 01a0c45e-b207-719e-a852-968f0751e522
title: Retain safe process-group control after the leader exits
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c3ae-c034-768e-bc07-ec06ea4dd607",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c3c3-7916-729c-a148-d546b2793096
  - kind: implements
    to: 01a0c3c3-5cae-7cce-af4b-00c64ef45bc7
sources:
  - kind: file
    ref: packages/execution-host/src/CommandLifetime.itest.ts
  - kind: file
    ref: packages/execution-host/src/nativeLaunch.ts
  - kind: file
    ref: packages/execution-host/src/PipeProcess.ts
---
Complete safe stopping and escalation for the original process group when its leader exits before the group's work. PipeProcess.endChild returns once the leader is ended, while nativeLaunch.signalPipes also uses the leader's exit to skip the force rung. A TERM-ignoring descendant can therefore remain after an accepted stop or deadline. The new CommandLifetime cases expose this distinction; the invocation, WebSocket and admission changes do not repair it.

Retain launcher/kernel-backed authority through group cleanup and use the same owned stop path for explicit stops, deadlines and scope release. A numeric PGID, kill(0), a matching command line or a reused PID is insufficient control authority; a sampled reading must not become permission to signal an unrelated process. Read PipeLauncher/runtimeLauncher and the native launch/ending contract before choosing the concrete retention mechanism. Keep incomplete or unavailable cleanup explicit.

Acceptance: with real test-owned children, both a leader that already exited and a leader killed by the first rung leave a TERM-ignoring descendant that the force rung actually ends; a gone/reused identity is never signalled; normal exits retain correct exit/accounting/output facts; released control cannot be spent again; end-to-end overhead for simple commands is measured. Do not mutate the running operator's host or kill its processes to validate this.