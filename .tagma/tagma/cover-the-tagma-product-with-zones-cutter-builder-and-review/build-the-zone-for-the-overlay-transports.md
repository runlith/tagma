---
id: 01a0c83d-a8fe-7fe8-bbce-e28c127dbea9
title: Build the zone for the overlay transports
ord: 81
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c841-f7bd-7e70-b134-13f52a41af0e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-a829-7d4b-bfbb-6824de36c9fd
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/primitives/src/deferred.ts
  - kind: file
    ref: packages/primitives/src/DialogRegistry.svelte.ts
  - kind: file
    ref: packages/primitives/src/Launchers.svelte.ts
  - kind: file
    ref: packages/primitives/src/overlay-signals.ts
  - kind: file
    ref: packages/primitives/src/Snackbars.svelte.ts
  - kind: file
    ref: packages/primitives/src/toast/Toaster.ts
  - kind: file
    ref: packages/primitives/src/types.ts
---
Fill [[e5f2057d]] with the claims its code establishes. Read `src/Dialogs.svelte.ts`, `src/Snackbars.svelte.ts`, `src/Launchers.svelte.ts`, `src/toast/Toaster.ts`, `src/overlay-signals.ts`, `src/types.ts` and `src/deferred.ts` whole, with `src/Dialogs.test.ts` and `src/toast/Toaster.test.ts`; the hosts that render these entries are [[b15dbefe]], so claim nothing of them. Watch what separates the four: only the dialog has an outro, so only it tells leaving the document from being closed and only it answers `reopen`; a snack bar and a launcher finalize in the same breath as the close; a toast's showing and dismissal are the vendor store's status changes, and a custom toast must carry its own priority because the vendor's table knows only its five semantic types. Watch what all of them share: the handle vocabulary in `types.ts`, a reactive behaviour rule that is a getter on a dialog entry and a plain field on a snack bar, and a signal pair whose `presented` rejects when a request ended before it ever reached the document. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[de36c9fd]]; the reference shape is the Layer kit [[59cc3c49]].