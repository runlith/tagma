---
id: 01a19491-7726-710a-8600-9c0649a368f1
title: Withdraw lapsed unread tasks without retracting accepted assignments
ord: 208
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19490-3ffb-79bc-bd02-20515b49f40a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a19471-c11f-7184-8092-d9bf92fd4cda
  - kind: relates
    to: 01a193f6-b5a6-7b27-880c-f9e668027cea
---
The unread-task conformance passes at 875e4a015 (07e70ac8a's parent; testbed report run.96228.1793494095552.jsonl), fails at 07e70ac8a (run.3752.1793494219841.jsonl), and fails at main 75306f050 (run.87972.1793493921497.jsonl). The same storagePort.test.ts request-lapse scenario ran alone through testbed in registered historical worktrees, without modifying historical code. Closing retains accepted assignments and unconfirmed assignment words that remain pending, including interrupts and detached tasks without reporting obligations. RunReports.lapsed marks unread journal words unconfirmed before acknowledgement, so even a transport that never reported an earlier unconfirmed fate can withdraw a still-running words-only opening. Closing uses the existing pending-word read, with no query over reporting obligations; conformance covers retained task/interrupt words and removed lapsed history. A late lapse closes and reports unread words without changing an already-ended run. Agent typecheck and 235 tests across 12 closing-related files passed; storagePort.test.ts also passed alone on randomized seeds 1, 2 and 3 (141 tests each).