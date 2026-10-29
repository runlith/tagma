---
id: 01a14c13-c481-7acc-8aa6-03c5f4dbd608
title: The operator edits files in tabs with autosave, and agents' edits merge into the buffer; a question — only about the same lines
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c6a28ec4cb
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c767192d2e
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/documents
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/FilePane.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/Drafts.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/OpenedDocument.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/PreviewTab.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/Tabs.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/Writes.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/contract/wire/document.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-files/contract/wire/settings.ts
---
**Value.** The operator and agents edit one file at once: the agent's lines appear around the operator's cursor, and the unsaved is lost neither on another's write nor on window close.

**How.** Checkout page tabs — file, diff, image, markdown preview; the file in the right area also switches between source and preview in its panel. Live document subscription and `write_document` saving; the `editor.autoSave` settings (off, after a delay, on editor focus loss, on window focus loss) and `editor.autoSaveDelay`.

**Behaviour.**
- Cmd+S writes at once in any mode; a dot on the tab means unsaved or a write in flight.
- A clean buffer takes the agent's write as a delta outside undo. A dirty one is rebased: non-overlapping edits merge in, an overlap becomes a conflict with holders and a Compare, Keep mine, Take the disk choice, and autosave pauses.
- Its own write is recognized by id and doesn't touch the buffer; a changed on-disk version is no error: the buffer waits for the new version and writes again.
- Hot exit: a dirty buffer is kept as a draft and returns after reload; a draft diverged from disk opens as a conflict.
- A file deleted on disk stays a tab with a mark and is recreated only if the operator keeps typing.
- The next single click replaces the preview tab; pinned tabs, recently closed (Cmd+Shift+T), and cursor position survive reload.

**Limits.** A non-UTF-8 file opens read-only; binary and too-large files aren't edited. With autosave off, closing a dirty tab asks. Drafts are capped by total size: what doesn't fit is protected only by a warning on window close.
