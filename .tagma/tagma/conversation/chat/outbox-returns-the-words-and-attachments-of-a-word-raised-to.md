---
id: 01a15cb9-29ef-7fd7-9f2c-4b310537e935
title: Outbox returns the words and attachments of a word raised to the next step to the field when send is refused after reload
ord: 59
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15c80-45a4-7400-9098-f51b45bd186d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15c97-6b29-7235-b1b3-abd3af6f7c28
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/PendingStore.ts
  - kind: file
    ref: packages/chat-ui/src/session/WaitingWords.svelte.ts
---
`WaitingWords.resay` resends a taken-down follow-up through `PendingTurns` but puts no draft in the outbox: these words have no local files, only server attachments. After reload `PendingTurns.revive` replaces `giveBack` with `PendingShelf.handBack`, and `PendingStore.handBack` returns only text and the stashed draft (`DraftShelf.unstash`). If resending such a word is later refused, only text returns to the field. The outbox entry needs to carry attachments with addresses, and return by it needs to download them into the draft the same way `ThreadDraft.takeBack` does, without a second copy of that logic.
