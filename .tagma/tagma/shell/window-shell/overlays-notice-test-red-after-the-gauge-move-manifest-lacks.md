---
id: 01a0caf3-62b7-7ead-b035-1e04deafe55e
title: "Overlays notice test red after the gauge move: manifest lacks UsageGaugeForm"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cb01-11ae-7e80-be80-b58a16fec8e4",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NoticeCards.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/overlays.svelte.test.ts
---
The folder-order repair moved `UsageGaugeForm` from `features/accounts/` to `shared/`, but the overlays suite still mounts without it: `overlays.svelte.test.ts` "a notice puts the column on screen…" fails with `UnknownServiceError: Service "UsageGaugeForm" is not in the manifest`, thrown from `NoticeCards.svelte:14` (the column reads the gauge form for its offset). The render dies in the error boundary, no `[role="status"]` stands, and the assertion fails on `undefined`.

Fallout of [[7ea49bec]], which is already marked done: add the moved service to the test manifest (or the layer that carries it). Done when the overlays suite is green again with the gauge module standing in shared.