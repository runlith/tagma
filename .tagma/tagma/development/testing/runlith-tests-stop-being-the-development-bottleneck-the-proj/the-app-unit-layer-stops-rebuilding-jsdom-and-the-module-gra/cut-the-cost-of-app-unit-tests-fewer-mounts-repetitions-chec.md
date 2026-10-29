---
id: 01a16e4c-6a9a-7eaa-b3e6-f27f876fdacc
title: "Cut the cost of app unit tests: fewer mounts, repetitions checked at their owners"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-914e-70b9-91f7-523752eaac28",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b705a099f1ad
---
In the expensive group, mounts and lifecycles merged: CheckoutPage 13→3 tests, DiffStage 11→3, Views 6→2, Pane 30→27; Column, already reduced by vitest-speed to one mount, left as read. Tabs/pathGroups repetitions, decoration checks and mock-call bookkeeping removed; checkout projections, format recovery, diff fallback/expand/refusal, leases and terminal input kept. All four changed files individually green on seeds 1–3 with one worker; final app `bun run typecheck`: 0 errors, one pre-existing a11y warning in CastView.svelte. An independent review confirmed the need to move pane across a gap without host: that scenario restored before the final checks. Commit 8c7d7b7b83; decisions and reports: scratch x10/x-http-app.tsv. Individual CPUs under load are not compared with the 183.53 s set baseline; the comparable after stays with the launching agent's measurement.
