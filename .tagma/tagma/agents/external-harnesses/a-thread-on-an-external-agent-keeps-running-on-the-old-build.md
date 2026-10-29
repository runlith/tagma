---
id: 01a16b5d-7897-74bd-9568-ce098da1f8be
title: A thread on an external agent keeps running on the old build's runner after a Tagma update, until the process dies
ord: 118
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16b5d-c732-716a-88f9-e64d40da7f5d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16b30-366a-7e95-8882-3a75165a13bd
---
Observation of 2026-10-24 on thread [[01a16b08-ee15-7003-95b6-d5dd064444b4|01a16b08]] (Claude Code over ACP). The runner process (`harness-run claude-code`, pid 29408) launched at 23:14Z from build `1fe84f65c8`. It served a turn started at 23:48Z after the thread stopped and a new message, and survived a server restart onto build `aa5f1c7a62` at 00:39Z. The fix [[165a13bd]] lives in the runner, so the thread kept hanging for the old reason. A fresh runner from the current build only rose after `kill 29408`. Other runners also live through restarts: pid 85444 launched at 21:04Z on 2026-10-23.

Right now a Tagma update does not reach live threads on an external agent until their process dies on its own, and the operator never sees it. Find the owner of the runner process lifetime (the ACP driver, `protocol/process.ts`, and the execution host) and decide when a runner from an old build is replaced with a new one without breaking a running turn — for example at a turn boundary, while the process executes nothing. That a runner survives a server restart for the sake of a running turn is a recorded decision ([[d0810682]], "call breakage and server restart"), and replacing it does not cancel that.
