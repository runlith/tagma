---
id: 01a1a37f-ee70-7a2f-8d85-72f6fefdc47c
title: An interrupted landing answers by its phase instead of letting a raw interrupt escape
ord: 207
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2e8-58ec-786f-bbe0-18df743004ce",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f83-c6c2-747e-b9fb-1385680193dd
---
A background submit_work ended with a raw InterruptError from the reshape read, so the caller had to read git to learn whether anything landed. submitWork now tracks the step it stands at and whether the publication witness was written, and maps an interrupt-only cause once for every step: `landing-cut` naming the step before the witness, the publication read-back after it.