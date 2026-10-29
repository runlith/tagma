---
id: 01a14bc0-75ae-7828-aae4-080c8bbb5b03
title: An unfinished message stays in its thread's draft and survives thread switches and page reloads
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7595-7388-9467-c90f6d8a1c85
  - kind: relates
    to: 01a14bc0-75bb-73fc-8d6e-9df22504cfd8
  - kind: relates
    to: 01a14bc0-75fb-7fcc-8d33-a734ed6ae602
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/DraftFiles.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/DraftShelf.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/DraftStore.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/SlotSelection.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/draftShelf.svelte.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/Draft.svelte.ts
    symbol: ThreadDraft
---
**Value.** The operator leaves for another thread or reloads the page mid-message and, on return, finds it in place with its attachments.

**How.** By itself: everything typed and attached in the composer is written to the draft on every change.

**Behaviour.**
- Each thread has its own draft, and the new-thread draft is one per project; the new-thread draft also keeps the pre-birth choice — agent type, model, approval mode, delegation, worktree — and passes it to the born thread.
- Words of a refused, recalled, or rolled-back turn stand in their thread's draft before the already typed text, without overwriting it, even when another thread is on screen.
- A bounded number of drafts is kept; the one touched longest ago leaves first.

**Limits.** The draft stays in this browser; it does not cross to another device. An attachment whose bytes the browser did not save is gone after reload, and the composer says so. Deleting the thread forgets its draft.
