---
id: 01a173cf-0288-7082-84d8-54ec5464ef76
title: A terminal CLI launch failure before the process is sent ends the session with a reason, a program defect lands in the fault list, and the thread shows the reason instead of a forever "Connecting"
ord: 144
tags: ["task"]
fields:
  {
    "holder": "tagma:01a173cf-6d0a-78a5-aca7-c934f4959137",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a173ce-e2ca-76bd-9d68-569034fc8341
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/drive.ts
---
`SessionDriver.attend` (`sessions/drive.ts:446`) catches every drive failure, program defects included, and moves the session to `uncertain`, writing only a warning to the log. In build 39658b0475 this is how a `ReferenceError` from `sessions/alignment.ts` landed: no CLI process launched, `read_faults` was empty, and the UI showed "Connecting to Claude Code…" / "Connecting to Codex…" forever (serve.log 2026-10-25 15:58Z, threads 01a173c8-98da-74ff-b441-6a1922c9c557 and 01a173c8-f30a-7071-9025-a5f70f58ac66).

`uncertain` means "unknown whether the process started". A failure before the start is sent is a known outcome: the session ends `failed` with a reason, as the account-picker refusal already does ([[fe977076]]). A program defect is additionally a server defect and lands in the operator's fault list. A session that stays `uncertain` for cause tells the thread what it is and how to continue, not "Connecting".
