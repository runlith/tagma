---
id: 01a1a97d-b2f8-794d-970f-fbaac370d283
title: The iOS touch tail closes on a 150 ms event gap while momentum still moves and flushes a held correction into it
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a94c-b35c-7345-bdbf-a18bf7904b4c",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a18468-c1f0-763f-8d37-046c1fa34c88
sources:
  - kind: file
    ref: patches/@tanstack%2Fvirtual-core@3.19.8.patch
---
virtual-core's iOS touch tail closes after 150 ms with no scroll event. Its `tailStillMoving` check reads whether the element still moved, but only while a command is queued (`state?.phase !== 'queued'` answers false). A held correction gets no such check: when the page's main thread stalls for more than 150 ms near the end of a fling, the tail closes, `_flushHoldIfReady` writes the held correction into the still-running momentum, and the momentum stops.

Evidence: iOS lane, CI run 41950417351 at 9def8b009, `native.e2e.ts` unmeasured-history (iOS 26). Momentum frames went 4216233 → 4216187 at ~9 px per frame up to 12797 ms; then no frame until 12955 ms (a 158 ms stall). At 12953 ms the held correction was flushed (`scrollTo` 4216123 → 4216322), and the momentum verdict counted one stopping write. The element had moved since the last event (4216187 → 4216123), which `tailStillMoving` would have caught had it run.

Fix at the owner: in the dependency patch (`patches/@tanstack%2Fvirtual-core@3.19.8.patch`), make the tail wait again while the element moved since the last event whenever a held correction or a queued command waits for the tail, not only for a queued command. Add it as a new hunk in `hunks.json` with a trap test in `packages/virtual-list` that fails without the hunk: a held correction under an iOS touch tail, a 150 ms silence while the element keeps moving, and no write until the element stops. Then `bun install` and `bun run patches:prove <hunk>`, and correct 1fa34c88.

Done when the iOS unmeasured-history scenario reports no stopping write under a stalled page.
