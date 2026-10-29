---
id: 01a127ed-8551-7cc0-a893-dc18a92d39dc
title: Transitions from spawn and to the parent take the home from the thread owner's answer, regardless of the list
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a127df-68ce-7e9a-94ba-389374c0f03d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/activityIdentity.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThreadSlot.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/snapshot.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/state.ts
  - kind: file
    ref: packages/agent/src/collaboration/births.ts
---
Project list may not have seen the addressee yet and holds no current or former parent from another home, so the home project arrives with the record owner's address. Verb results and delivery receipts keep the reached thread's home; a resend goes to the recorded recipient even if the name has moved elsewhere. The feed snapshot carries the address of the existing current or former parent. The app passes the received navigation pair through regardless of the list and the chat or terminal surface choice.
