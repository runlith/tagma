---
id: 01a151df-e920-73d7-9b09-09e05d158760
title: A standing terminal resource without a run rises on first launch, not as a full list at server start
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-6ae2-72a7-8565-b02edaf63602",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/serving.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/drive.ts
---
On server open `external-harnesses/serving.ts` calls `resource.watch` of every transport; for terminal that is `sessions.recover()` (`external-harnesses/assembly.ts:502`), which reads the facet of every standing terminal flow one by one and sits on each (`sessions/drive.ts:330–349`). Startup cost grows with the number of standing terminal flows, not with running runs.

Do: the core reaper restores runs via `adopt`; a runless resource rises lazily, on the next launch, and its lease passes to the new owner on rise; standing resources are reconciled against live host executions with one query. Extending resource leases with one batched UPDATE per adapter and owner is the operator's decision and is not reworked. The ACP idle policy is not part of the task.

Done (`16b561c5d4`): startup reads standing sessions with one `sessionsStanding` (with an in-run flag) and reconciles them with the host with one `Terminals.recordsOf`; it takes the lease only on sessions with a run, with a gone process, in transition, and on adopted ones (their job is seen only by the driver). An idling live session is raised by first use — the first hook (`TerminalEvents` → `SessionDriver.raise`), print, `launch`, `stop` — or by its process end; a fresh lease of a departed server passes on expiry. Observation timers recover only on an open turn or unread words. Check: `terminalDelivery.stest` "a starting server takes up the terminal sessions with a run, and an idle live one at its first hook, at 10 and at 40" — with 10 and 40 idling and 2 live running: idling ones stay with the previous owner, running ones move to the new one and their runs continue, the first hook raises an idling one. drive.ts crossed 650 rows — debt on [[31623d02]].

Measurement (2026-10-19, `terminalDelivery.stest`, `sql.execute` spans under `SessionDriver.recover` and `SessionDriver.beat`, one sample on a loaded machine): startup with 10 and with 40 idling sessions — 2 statements, 0 writes, 12 and 42 rows returned (one row per standing session of one `sessionsStanding`); the same startup with 2 running — 79 statements and 2 writes (taking the lease of two sessions; the count includes queries of their leading fibers that made it before `watch` returned, so the figure is an upper bound); the lease beat — 3 statements (`BEGIN`, one batched `UPDATE external_session … lease_beat`, `COMMIT`) with 3 led sessions, idling ones not included. The startup statement count on 10 vs 40 is compared by the test (equality); row counts and the beat are from a one-off probe that was not saved.

Proof: an integration measurement on 10 and 40 idling terminal flows and 2 running ones — startup reads, SQLite rows read and startup/beat writes grow with running runs and standing resources, without reading a facet per flow.
