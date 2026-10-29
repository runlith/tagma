---
id: 01a0e02e-edf6-7a7b-aa3b-871ece75ea96
title: Show one server-measured clock for a whole thinking spell in the thread row and the chat
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e02f-2dc6-76a4-bf77-2dcd951b5f08",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/harness/workLine.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/activity.ts
  - kind: file
    ref: packages/chat-ui/src/liveStatus.ts
---
The "Thinking" clock restarts while one thinking spell continues. The operator wants one clock per spell that shows how long the model has actually been thinking — the same after a reload, a tab switch, or opening another browser.

**What happens now, read from the code:**
- **Thread list row.** `workLine.ts` keeps `thinkingSince` in client memory (`workLines.svelte.ts`, a module singleton). It is dropped whenever the row stops reading as working with an activity, is lost on reload, and differs per browser. `threadActivitySchema` (`apps/tagma/server/src/harness/protocol.ts`) carries no instant. Claim [[27511383]] states this as a limitation.
- **Chat.** `packages/chat-ui/src/liveStatus.ts` measures `phaseMs = now − activity.since`. `strings.ts` words `calling`, `reasoning` (and the row's `preparing`) all as "Thinking", but `since` restarts on each raw phase change. The word stays while its clock drops back to zero.

**Target:** the producer stamps when the current thinking spell began. Both surfaces draw `now − that instant` and keep no clock of their own. Keep the spell's definition from [[27511383]] unless the code shows a better one: calling, preparing and reasoning are one spell; a tool call or another phase ends it.

**Acceptance:**
- The same spell shows the same elapsed time before and after a reload, in two tabs, and on the list row and in the chat.
- A tool call or a writing phase starts a new spell.
- Pages open on the previous server still decode what the new one sends.
- The behaviour is proven at the owner, not by a UI ceremony test.
