---
id: 01a14170-c91d-7944-9ec2-0afeb2a15989
title: "Server start and restart wait for the execution host on facts: bring-up, logic arrival, handover, bundle assembly, and recovery without deadline verdicts"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14170-f7af-7d17-a508-b8d45f938205",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1415a-db80-7f6b-b559-38f85c98bd35
  - kind: relates
    to: 01a14167-857d-7f4b-80de-e40f7609a86c
sources:
  - kind: dir
    ref: apps/tagma/server/src/executions/host
---
Server start and restart wait for the execution host with deadlines, and on a slow machine those deadlines produce a false refusal in the middle of an ordinary update. Law [[7609a86c]]: the verdict is a fact; a deadline only decides when to ask again.

**Where deadlines stand in the start and restart path** (`apps/tagma/server/src/executions/host/`):
- `boot.ts` — host bring-up: "did not answer within N ms of being started", though the holder is alive.
- `arrival.ts` — the successor waits for its digest's logic `patienceMs`, and the same deadline cuts the status request short ([[ce39be5f]]).
- `departure.ts` — handover: status with `timeoutOrElse`, refusal "did not answer within … cannot be handed over".
- `offer.ts` — host bundle assembly: `PATIENCE_MS` 20 s, "no host bundle was produced".
- `recovery.ts` — the recovery program: `READ_PATIENCE_MS`, `SHUTDOWN_PATIENCE_MS`.
- Nearby: `power/pace.ts` ("the execution host did not answer within a minute"), `executions/operations/machine.ts` (`timeoutOrElse` on the host answer in the machine state).

**To do.** Every wait ends on a fact: an answer, a defined refusal, a process exit (holder, logic, program), a freed or held writer claim, a recorded failure. While the expected process is alive and holding its own — wait. Where the owner does not publish a fact to wait on, the owner publishes it; no consumer waits on a deadline. Notes that describe deadlines as the contract ([[ce39be5f]] and others found via sources) are corrected by the same change.

**Done when** tests over the real functions show: a live but slow host/program is waited past the old deadlines and ends with its answer; a departed process ends with a refusal carrying its cause.
