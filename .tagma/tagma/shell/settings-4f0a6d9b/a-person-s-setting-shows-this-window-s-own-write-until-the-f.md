---
id: 01a1b261-9f03-73e0-a27d-79ec8e9358e3
title: A person's setting shows this window's own write until the feed answers after it, and a failed write drops only that edit
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/UserSettings.svelte.ts
---
`UserSettings` keeps two values per key: the last one `settings.watch` confirmed, and this window's pending write. The pending one shows from the moment of the write; it gives way to the next feed event once the server answered, or at once to an event carrying the same value. A refused or lost write clears only its own pending edit, and only if no newer write of this window replaced it.

Restoring the value seen before the write was rejected: by the time the answer fails, the feed may have brought a newer value from another window or device, and the restored snapshot would paint over it in this window alone, with no later event to correct it. A write whose answer was lost after the server committed it needs no special case: its value arrives through the feed like any other.

Every reader of the person's keys in a window goes through this one owner, over one `settings.watch` holding the union of their keys, so a write needs no project: the user layer is the machine's.