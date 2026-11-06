---
id: 01a1b2a6-a87c-70b4-a1c3-4b1e4bfe38e9
title: A fast ref click right after a wheel scroll can miss its target while the page still scrolls
ord: 61
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b200-4574-77bf-b4e2-13af32a800b4",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/act.ts
---
In fast input, an `act_on_page` sequence `scroll {x, y, dy: 120}` then `click {ref}` on a page tall enough to scroll completed without refusal while the target's click listener never ran, in 2 of 6 runs of the input conformance (`browser/testing/input.ts`; once on managed Chromium, once on Electron); a shorter page that cannot scroll never showed it. The likely cause — the box being measured while Chromium still animates the wheel scroll — is unproven. Establish the cause and make a fast ref click aim at the settled position; the conformance scenario keeps that order out until then.