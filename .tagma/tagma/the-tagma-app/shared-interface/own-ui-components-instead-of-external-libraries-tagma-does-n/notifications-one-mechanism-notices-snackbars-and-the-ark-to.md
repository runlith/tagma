---
id: 01a13d48-9aa9-71d0-a2d8-690372053c34
title: "Notifications — one mechanism: `Notices`; `Snackbars` and the ark `Toaster` leave the kit"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NoticeCards.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/notices/Service.svelte.ts
  - kind: file
    ref: packages/primitives/src/Snackbars.svelte.ts
  - kind: file
    ref: packages/primitives/src/toast/Toaster.ts
---
Today Undo is shown by two mechanisms, in different places with different lives:
- `Notices` — a column at top right, undo lives 6 s, at most three. Graph blocks go through it (`graph/TreeScreen.svelte.ts:314`).
- The kit's `Snackbars` — bottom centre, `UndoNotice` lives 8 s. Removed files, thread moves into a folder, thread detaches, and replacing edits with the on-disk version go through it.

The ark `Toaster` is created at startup (`app/overlays.ts:9`), but no overlay is declared as `toast`, and it has no host.

**`Notices` is the owner.**
- One column. On a wide screen it stands at top right, on a narrow one at the bottom, by the thumb, where undo stands today (`app/mobile/Threads.svelte:43`, `app/mobile/Actions.svelte:20`).
- Undo lives 8 s, at most three at once.
- Four openings (`threads/filing.ts`, `threads/detach.ts`, `checkout/files/FileOps.svelte.ts`, `checkout/files/FileNotices.svelte`) become `notices.undoable(...)` calls. The `Snackbars` dependency, threaded through 11 files, leaves all of them.
- `undoable(..., life)` receives the list or app scope, not lines and not menus. Detaching takes the line out of the list, menus and Peek unmount, and undo with their scope would vanish immediately.
- The column stands on the notifications step, above dialogs and the palette. Until [[313c7343]] — with an inline style from `layers.ts` instead of `z-50`.
- The card appears with a Svelte transition instead of `animate-in fade-in slide-in-from-right-3` classes.

**Removed from the kit:**
- `Snackbars.svelte.ts`, `SnackBarHost.svelte`, `toast/Toaster.ts` with its test and their types;
- the `snackbar` and `toast` transports: in `OverlayAs`, `Overlay.materialize`, `Overlay.closeAll`, and the `toast` branch in `coexistByDefault`;
- package exports and helpers in `testing.ts`;
- snackbar and toast mentions in the package `description`;
- the `@ark-ui/svelte` dependency.

Queue tests (`OverlayQueue.test.ts`, `Overlay.test.ts`, `door-laws.test.ts`) are rewritten for `dialog` and `launcher`. `SnackBarHost` leaves `app/Root.svelte`, and `UndoNotice.svelte` is deleted.

**Performer check** (unit):
- undo lives 8 s and invokes the action;
- at most three at once;
- undo survives unmounting the line it was created from.

`rg` for `Snackbars|SnackBar|UndoNotice|Toaster|@ark-ui` in `apps` and `packages` is empty.
