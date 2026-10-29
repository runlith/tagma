---
id: 01a0c83d-a92c-73b4-85c4-f93d3c062247
title: Build the zone for the overlay hosts
ord: 84
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c842-994e-78af-8344-343961ab98a5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/primitives/src/dialog-handle-context.svelte.ts
  - kind: file
    ref: packages/primitives/src/DialogHandleProvider.svelte
  - kind: file
    ref: packages/primitives/src/DialogHost.svelte
  - kind: file
    ref: packages/primitives/src/DialogLayer.svelte
  - kind: file
    ref: packages/primitives/src/LauncherHost.svelte
  - kind: file
    ref: packages/primitives/src/LazyOverlay.svelte
  - kind: file
    ref: packages/primitives/src/SnackBarHost.svelte
---
Fill [[b15dbefe]] with the claims its code establishes. Read `src/DialogHost.svelte`, `src/SnackBarHost.svelte`, `src/LauncherHost.svelte`, `src/DialogLayer.svelte`, `src/DialogHandleProvider.svelte`, `src/dialog-handle-context.svelte.ts` and `src/LazyOverlay.svelte` whole, with `src/Dialogs.test.ts` for what a host is expected to report back. Watch: why the error boundary is per entry and never around the host, and what its null fallback and zero retry budget mean for a throwing view; why a depth ticket is claimed untracked during render and released on destroy rather than on close; what the class override switch does to a caller's classes and when a caller's string replaces rather than merges; why the snack bar and launcher hosts report presence through an attachment where the dialog host reports it through the content's own callbacks; and the reason `LazyOverlay` is a component rather than an `{#if}` around a dynamic import — that reason is stated in the file and is the sharpest claim here. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[de36c9fd]]; the reference shape is the Layer kit [[59cc3c49]], whose Svelte world [[1a712a78]] is the granularity to match.