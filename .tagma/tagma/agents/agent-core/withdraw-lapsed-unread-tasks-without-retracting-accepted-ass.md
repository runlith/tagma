---
id: 01a19491-7726-710a-8600-9c0649a368f1
title: Withdraw lapsed unread tasks without retracting accepted assignments
ord: 208
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19490-3ffb-79bc-bd02-20515b49f40a",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9bf92fd4cda
  - kind: relates
    to: 01a193f6-b5a6-7b27-880c-f9e668027cea
---
Confirm the unread-task withdrawal regression against 07e70ac8a and its parent, then correct the kernel closing contract so a lapsed unread request closes and withdraws its words while an accepted assignment survives an execution stop. Prove both through the affected memory conformance suites.