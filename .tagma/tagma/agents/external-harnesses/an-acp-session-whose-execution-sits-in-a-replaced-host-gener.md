---
id: 01a1784b-73a7-7eb5-93b1-007e79bcd0db
title: An ACP session whose execution sits in a replaced host generation ends as lost, never sliding into uncertain
ord: 147
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17838-96e3-7eaa-b817-177c62aac80c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17840-e1b7-7cec-8268-b118346e149c
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/process.ts
---
An ACP session whose execution stayed in a replaced host generation must end as lost (`LOST_LINE`), never stick in `uncertain`.

`ProtocolProcess` (`external-harnesses/protocol/process.ts`) currently reads the execution's output road first and only then asks `TerminalEndings.decided`. For a replaced generation `Terminals.records` (`executions/terminals/reads.ts`) at once refuses with `TerminalRefused('record-lost')`. Per the reviewer's reading, that refusal escapes `run` via `protocol/link.ts`, and `ProtocolAttendance` writes the session `uncertain`, so the `Unwatchable` → `LOST_LINE` branch is never reached. Even with output already read, `stderrTail` without saved stderr may fall before `steps.observe(Exited)`.

Do: a lost execution on the output road ends the session with `LOST_LINE`, not a driver failure. Test through the ACP driver door on a replaced-generation execution.
