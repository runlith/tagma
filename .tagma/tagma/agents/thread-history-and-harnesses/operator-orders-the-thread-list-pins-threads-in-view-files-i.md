---
id: 01a14bae-6720-7d62-897a-92977939353e
title: "Operator orders the thread list: pins threads in view, files into folders, gives names"
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
  - kind: supersedes
    to: 01a14b6d-b285-7ec1-b63c-ce8d5e5b32c5
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/FolderRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/PinnedBand.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/folders.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
    symbol: THREAD_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: autoTitle
---
**Value.** The operator keeps the thread list in their own order and recognizes threads by name.

**How.** Pinning, folders, and renaming in the list; operations `pin_thread`, folder operations and `file_threads`, `set_thread_title`, `generate_thread_title`; the `threads.autoTitle` setting.

**Behaviour.** The thread itself is pinned at any level. Pinned roots stand on top in pin order; a pinned sub-agent, once finished, stands under its parent above the "N finished" fold and keeps finished ancestors in view. The operator's word to a sub-agent pins it on its own; Detach carries the mark into the root, Return under keeps it. Deleting a folder returns its trees to the list. Threads with a random birth name get an auto-name, and a manual name is never replaced by it. A CLI thread takes its CLI's name.

**Limits.** An on-demand auto-name is for roots only. A thread outside its own subtree is renamed by an agent only on the operator's word.
