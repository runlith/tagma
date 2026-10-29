---
id: 01a0d857-51a5-7749-87bc-bb0ed98ba5db
title: read_performance profile with raw dumps the whole artifact inline
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "The whole profile artifact came back inline in the tool answer, and the agent spent its context on bytes it then had to move to a file.",
    "command": "read_performance {profile, raw}, 2026-09-25, thread 01a0d842",
    "expected": "A raw profile is handed over as a file path or a bounded page, like other large reads."
  }
---
Filed from project `runlith`.