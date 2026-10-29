---
id: 01a14e43-2bcd-7818-8b69-eeb01f3cc08a
title: An ACP run the reaper stopped after a restart does not cancel the vendor turn until words arrive in the thread
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01f6-7d00-af4d-7f2b2b1aecb7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14e38-b0a3-73f8-a01c-3961e47cdfcd
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/attendance.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunReaper.ts
---
Review [[e47cdfcd]] finding (Sol). A handed-off run with a standing stop is ended at once by `ThreadRunReaper.decide` (`lifecycle.stop(..., false)`) without telling the transport. The ACP process stays alive: `ProtocolAttendance.observed` sees a live session with unparked row turns and waits for process exit instead of attaching. `ProtocolProcess.drive`/`recalled`, which sends `Cancel` once the core run is no longer `running`, is never called. The vendor turn runs until new words trigger `attendance.ensure`.

Find the trigger owner (the reaper tells the transport it stopped its run, or ACP observation attaches once its turn's run is over) and fix it. Proof is a restart test: after an orderly restart with a standing stop, the new server cancels the vendor turn of an ACP run with no new words.

Outcome (64f8abc054, d05abb563): ownership of the fix: core tells the transport about a run end with the same `Transports.interrupt` it uses after `reap`; `ThreadRunReaper.decide` now calls it for a standing-stop candidate too. `ProtocolAttendance` owns vendor-process recovery: `ProtocolRuns.interrupt` for a run with no transport and no launch, when the run is over but the protocol row still holds its turn, hands the thread to `attendance.recall`; observation (`observed`) attaches the process once the turn's run is no longer `running`, retrying on the takeover tick while a foreign lease holds the session. The existing `ProtocolProcess.drive`/`recalled` step sends `Cancel` — no second cancel road.

Proven: the parity test "a stop still standing at an orderly restart cancels the vendor turn of an ACP run with no new words" — without the `interrupt` call in the reaper it waits 15 s for `session/cancel` and fails; with it, it passes; the remaining restart and protocolRuns/Stops/Handover/Transport scenarios pass.

Not proven by test: the Sol review case where the session lease is still fresh after a server crash while the run is already over — the observation retry path is read from code, with no scenario for it.
