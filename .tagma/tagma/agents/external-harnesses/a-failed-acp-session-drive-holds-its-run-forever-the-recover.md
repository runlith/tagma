---
id: 01a15b87-fd93-7648-ba16-03f4700ff263
title: "A failed ACP-session drive holds its run forever: the recovery that `session-uncertain` promises never comes"
ord: 85
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b88-e429-73d6-a7bb-5e1330521d6e",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/attendance.ts
---
When `process.drive` fails without an interrupt, `ProtocolAttendance.attend` marks the session `uncertain`, writes a warning to serve.log, and unlinks. But `launches.leading` keeps holding the session's run, so `TransportRuns.holds` (`protocol/runs.ts`) keeps answering "holding", the beater keeps beating the run, the reaper never hands it to `adopt`, and the run sits `running` with no motion forever: no failure line in the thread, no operator-list entry. Case: thread `01a15ac1-2b9a-7fc6-b993-3b1f606e8186`, run `01a15b56-c63f-71e5-a724-f167deeee9c9`, from 20 October 22:29:25. Fix: a server whose drive has died stops holding that session's runs, and recovery picks them up (adopt → drive again; a deterministic failure ends the run at the recovery limit with a visible cause); the drive's death lands in the operator error list. Prove with a system test in `protocolRoad.stest.ts`.
