---
id: 01a12826-cc61-78dd-9f69-908b6adeb9ab
title: submit_work names already-landed lines as remaining uncommitted
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "After 9d72f97fd8 the answer re-listed its 36 committed paths as uncommitted; after 3cd0efb5f5 — contract.test.ts and the same threads paths. An immediate read_changes answers no line differs from HEAD, scoped git diff empty.",
    "command": "submit_work whole:true: commits 9d72f97fd8 and 3cd0efb5f5; then read_changes on paths and git diff --name-only over the task f249a450's three areas",
    "expected": "The left list holds only lines that still differ from HEAD after this landing."
  }
---
The wrong remainder forces verifying the landing with a separate read; the commits carry the stated changes. In this wave the answer's extra tail grew to dozens of paths.
