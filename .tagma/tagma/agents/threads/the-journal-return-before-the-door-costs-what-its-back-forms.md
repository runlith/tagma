---
id: 01a1ae21-c762-7b2a-874c-80919d4f6d9b
title: "The journal return before the door costs what its back forms touch: a refusing record stops nothing, untouched rows and threads are not passed"
ord: 170
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1ace6-ac40-7866-b9c1-ffdac5137949",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1ad93-2710-787d-8cba-111850881cc3
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutReturn.ts
---
`rolloutReturn.ts` runs each back form inside the page transaction, so one `ThreadFormRefused` fails `returnOnto` and leaves every later page, column and file in the newer form, against 50881cc3. It also sends every row of every touched column through the process boundary in pages of 64, each its own write transaction with every payload parsed, and restages every thread whose mark is past the target even when the reversed steps carry no form, removing its transcript, so the previous release refolds each one. Done when a refusing record leaves only its thread as it stood and is named in `unreturned`, rows are chosen in SQL by the record kinds the back forms touch, and a thread is restaged only when a reversed step has a form for it.