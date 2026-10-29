---
id: 01a128fa-aef2-72aa-b45b-5c3b19477b27
title: submit_work lists already-landed paths as still uncommitted
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "submit_work listed ExecutionInput.ts, holder/Holder.ts, and posix/Descriptor.ts as still stand uncommitted, though they were in committed; an immediate read_changes showed 0 held paths. The same mismatch previously followed 1c6f762660. Cost: one extra read after each such answer.",
    "command": "submit_work(subject=\"Keep startup resilient and terminal interrupts ordered\", paths=[12 paths], whole=true) → 8422fc47c8; then read_changes(limit=1)",
    "expected": "After landing, the list of remaining paths matches the change record's current judgement."
  }
---
Filed from project `runlith`.
