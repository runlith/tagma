---
id: 01a131f4-650b-7798-a768-7dc2313bbd47
title: "Optimistic thread archiving in the app: the row leaves at once and returns on refusal"
ord: 49
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13205-6519-7972-8004-f3edc9f17afb",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ColumnState.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/List.svelte.ts
---
Today `ThreadList.setArchived` (`app/src/lib/features/threads/List.svelte.ts`) waits for the `archive_thread` response, and the row leaves the list only after it — under load that is 0.4–8 s during which archiving looks broken.

Make archiving optimistic: the row (with its subtree) leaves the active list at once on the act — from the `e` key in the column, the menu, and peek; on a server refusal it returns to its place and an error shows. The move to draft when archiving the open thread also happens at once. Unarchiving mirrors it. Batch `filing.ts` uses the same path.

The "left but unconfirmed" state is held by the list owner (`ThreadList`), not components: the row projection accounts for it, live list updates from the server clear it. Rule [[46899e82]] stays: only one's own row dims.

Proof: a `ThreadList` test — the row disappears before the response, returns on refusal; the operator's manual check under load.
