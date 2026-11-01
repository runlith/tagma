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
The unread-task conformance passes at 875e4a015 (07e70ac8a's parent; testbed report run.96228.1793494095552.jsonl), fails at 07e70ac8a (run.3752.1793494219841.jsonl), and fails at main 75306f050 (run.87972.1793493921497.jsonl). The same storagePort.test.ts request-lapse scenario ran alone through testbed in registered historical worktrees, without modifying historical code. Closing must retain an accepted assignment and any unconfirmed assignment whose reporting request remains open; closing that request unread permits withdrawing its words-only opening. The closing owner now makes that decision against the inbox in the same transaction, and conformance asserts both retained open requests and removed lapsed history.