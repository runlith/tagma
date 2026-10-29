---
id: 01a146a4-3507-7e7d-a582-a7dced0201b2
title: Thread menu closes at once on selection, and a forking thread is visible in the list until the server answers
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a146a5-57ae-705f-ba61-465b35afe742",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/List.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Menu.svelte
---
Pressing "Fork" in the thread menu left the menu open with a grey item and no indicator for the whole fork (12 s, [[467f23ab]]). Cause: the item's `onclick` (`apps/tagma/app/src/lib/features/threads/Menu.svelte`) synchronously sets `busy` through `ThreadList.hold`, and the bits-ui `MenuItemState.onclick` runs after it, sees `disabled`, and skips closing. The same defect affects Pin/Unpin, Archive/Unarchive, Detach/Return in this menu.

Do:
- the menu closes at once on any selection; dimming applies only to its own row's act (rule 46899e82);
- a forking thread is visible at once where the new thread will appear in the list: a row with its future title and a birth indicator; when the server answers, the real row replaces it and the thread opens as now (`shell.openThread(…, 'main')`); on refusal the row goes away and the cause is shown in the refusal's words (snackbar/notice, as other list acts do);
- "Branch" from a message (`native/Rewinds.svelte.ts`) gives the same visible feedback while the branch is being born;
- no confirmations or extra controls (rule 0f144655), token styling (rule 55b5437b).

Proof: tests on the list and menu contract — selecting an act closes the menu; a forking thread stands in the list until the answer and is replaced by the born thread; a refusal removes it and reports the cause. App `bun run typecheck`, affected test sets. A live check on the stand (`tagma:try` on its own root and port) is at the performer's discretion; the operator's working server is not restarted.
