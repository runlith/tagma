---
id: 01a0c702-18d6-741f-bb4f-827fbf9c109f
title: Build the zone for layer's environment doors
ord: 61
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c713-27d9-7346-b29f-beb6279d8706",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/Host.ts
  - kind: file
    ref: packages/layer/src/Mark.ts
  - kind: file
    ref: packages/layer/src/Platform.ts
---
Fill [[be347c19]] with the claims its code establishes. Read `src/Platform.ts`, `src/Host.ts` and `src/Mark.ts` whole; the cookie wire beneath them is [[1f6ad744]], a task of its own, so claim the door and not the format. Watch: which storage and cookie failures the guard answers and which it deliberately lets through as a defect in the call; why the browser door is opened per call rather than at module evaluation; why a `Secure` cookie asked for over http is refused instead of dropped; and what the server's doors answer so that a reader written for the browser needs no branch. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].