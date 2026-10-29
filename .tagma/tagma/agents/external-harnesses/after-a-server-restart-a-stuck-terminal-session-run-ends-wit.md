---
id: 01a173ec-fb5a-74fa-aae2-389ee5ba29bc
title: After a server restart a stuck terminal-session run ends with its own session cause, not the core recovery's generic cause
ord: 146
tags: ["task"]
fields:
  {
    "holder": "tagma:01a173cf-6d0a-78a5-aca7-c934f4959137",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a173cf-0288-7082-84d8-54ec5464ef76
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/lifecycleDriver.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/runs.ts
---
Remainder of [[5464ef76]]. A stuck `uncertain` session with no live run reaches its end at the next attend or server start and writes its own cause (`unlaunched: …`). But the new server's `OpenRuns` has no such run, so the core recovery closes the run with its own generic cause instead of the session's cause. Fix: recovery takes ownership of the run before the session is reconciled. Touches the boot order and the terminal adopt path (`terminal/runs.ts`).
