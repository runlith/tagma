---
id: 01a17ef7-6c80-7845-a1f7-b35bbbc63a58
title: "Changes tab: the Scratch file opens in its preview, and the user switches the list/preview split in the \"…\" menu"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ef7-b425-7506-a117-301e7d691e24",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03b603abb142
  - kind: relates
    to: 01a17eb0-7162-70be-bd54-bafba8539513
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/Changes.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ScratchRows.svelte
---
Two edits to the thread Changes tab on the operator's word.

**The Scratch file opens in the Changes tab preview, not as a separate tab.** A Scratch row (`ScratchRows.svelte`) is a `file`-kind link. Its "beside" click goes through `FileOpener` into `Beside.show(filePane)` and opens a new file tab in the right area. A change row is a `change`-kind link: its "beside" is placed by `ThreadChanges.open` and shows `changesPane`, so the file opens in the preview right of the list. Rows of one list must open in one place: clicking a Scratch file shows its contents in the same preview, ⌘-click and the link menu follow the shared link rule ([[ce1ef098]]). A Scratch file has no diff: the preview shows the file itself (text, image, markdown) with what already draws files in the right area, not a second copy.

**The user switches the list/preview split off.** After [[a8539513]] list and preview always stand side by side. A user choice is needed in the tab's "…" menu (`ViewMenu`): side by side (default) or one column, where the open file covers the list and offers a "back". The choice persists across openings, like other view settings. This is a layout changed by the user's hand, so it does not break [[e7449703]].
