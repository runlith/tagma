---
id: 01a16def-8311-7d8b-bcc1-d1f8be8b5927
title: Cheapen the execution-host root tests and the executions package
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16def-4318-72d7-ac35-7b2b1e887593",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Per the order to finish only the current group, MachineLoad is narrowed: the kernel reaped-CPU conformance kept, duplicate ProcessUsage and CPU-burning yes removed; file CPU 4.4 → 0.6 s, −86%, seeds 1–3 and typecheck green, commit 37a1cce3c4. In executions the upstream FilePosition smoke removed, the spawner moved to unit with the same four scenarios; seeds 1–3 and typecheck green, commit ef46b59a2b. For these two files packet before 0.3 s, after spawner 0.3035 s in a cold separate run and FilePosition 0: conditions incomparable, no overall factor. Remaining scope unchanged. Results: host-root.tsv in the parent scratch; no uncommitted lines.
