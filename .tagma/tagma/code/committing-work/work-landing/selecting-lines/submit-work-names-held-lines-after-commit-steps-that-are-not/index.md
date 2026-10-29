---
id: 01a12992-49ab-7985-8fe1-5afc3c2ed99d
title: submit_work names held lines after commit steps that are not in the working tree or current read_changes
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Commit c855ff67f0 landed with 14 paths, but the answer declared uncommitted lines in budget.ts, implementation.ts, and probes.ts. The next read_changes showed held=0, git diff on those three files empty. It took extra read_changes and git diff; turns of the same read still print held for these paths.",
    "command": "submit_work({subject:\"Fix import inspection envelopes and importer invalidation\"})",
    "expected": "The landed answer lists only held lines that truly remain after commit steps are applied to the working files."
  }
---
Filed from project `runlith`.
