---
id: 01a179c9-bfb4-76ab-8a43-4041e1d4c1f1
title: Git tab effects report the standing read error as a card on every restart
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a179c9-bfb4-76ab-8a43-403ac8860d90
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitHistory.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/GitView.svelte
---
`GitView.svelte` (`log.failed`) and `CommitHistory.svelte` (`commits.failed`) call `notices.refusal` from an effect that reads the request error: every effect re-run reports it again, and a background-read refusal goes into a card against [[2a197ac2]]. The likely source of the 2026-10-26 case is the checkout's `not-found` ×1001 and the page boundary's `effect_update_depth_exceeded`; unverified, because the window didn't record the component. The read error shows in place of the tab data, the loop is found and removed; the test is a request error standing over several flushes yields no repeated messages.
