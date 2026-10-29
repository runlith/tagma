---
id: 01a0d631-5015-75ff-9d0f-94dc3ba52106
title: A bash call shows the default limit while it prepares, though a command rule decides its limit at admission
ord: 62
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d631-8428-7490-813f-9fb65d0b53fc",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent-tools/src/bash
---
**Seen on 2026-09-25.** A foreground `bash` call of thread 01a0d4d0 stood in the surface for 1 min 49 s, labelled "limit 10m default", while it measured the checkout. Its command, 76fdac80, was admitted under thread rule edbb74eb with a 90 s limit and ran for 0 s.

The display facts in `packages/agent-tools/src/bash.ts` fall back to `commandTimes.defaultMs` whenever no run is admitted yet and the caller named no time. A rule in force is shown only after admission.

**Done when:**
- a call whose limit a rule will decide never shows the default as its limit: it shows the rule's figure, or no limit until admission;
- a test covers a rule standing over the thread.