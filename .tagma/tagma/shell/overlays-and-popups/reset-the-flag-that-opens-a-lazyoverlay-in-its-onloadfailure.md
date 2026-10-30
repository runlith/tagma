---
id: 01a0c855-a24a-771d-ba5f-fb58f887e847
title: Reset the flag that opens a `LazyOverlay` in its `onLoadFailure`
ord: 15
tags: ["rule"]
sources:
  - kind: file
    ref: packages/primitives/src/LazyOverlay.svelte
---
After a failed chunk load the overlay stays pending and never retries on its own.