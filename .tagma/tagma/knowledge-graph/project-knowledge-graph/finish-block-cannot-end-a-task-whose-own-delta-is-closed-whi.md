---
id: 01a0d972-d611-779c-9a32-5c56d3bf7ecf
title: finish_block cannot end a task whose own delta is closed while a peer's deltas on the shared decision are open
ord: 204
tags: ["reflection"]
fields:
  {
    "actual": "Without specOk it refuses spec-unverified (\"task implements specs c71a780a; confirm their truth or record the divergence\"). With specOk: true it refuses spec-diverged, naming the peer task's unresolved deltas 804f74f8 and 8ce5add6 on b9bdfa95. No road finishes the task until another session resolves its deltas.",
    "command": "finish_block 402bf88f commit fb98c4e2c5 (runlith), with and without specOk: true",
    "expected": "The task finishes: its divergence from decision b9bdfa95 is recorded as delta c71a780a, which is closed into verified claims and itself verified; the peer task 40e4a0a0's open deltas on the same decision belong to that task."
  }
---
Filed from project `runlith`.

Two builders implement one decision in parallel (402bf88f, 40e4a0a0 on b9bdfa95). file_delta makes the delta a spec the filing task implements, so the task now implements b9bdfa95 and c71a780a. specOk attests every implemented spec, which includes b9bdfa95, and that attestation is blocked by the other task's deltas. The unblock "file_delta on c71a780a" would mean a delta on a closed delta. Cost: the task stays in_work after its work landed and was reviewed; the parent must finish it later by hand.