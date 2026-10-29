---
id: 01a13295-57e0-7180-8b28-fd20c1db381a
title: submit_work refused commit-step-failed on a valid, unchanged tagma.jsonc, then landed on an unchanged retry
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "refused[commit-step-failed]: \"tagma.jsonc (tracked) does not declare valid commit steps: JSON Parse error: Unexpected EOF\". The identical call a few seconds later landed 6af0616ded. The declaration was read as truncated or empty, likely mid-write by another session's checkout operation, and the refusal tells the agent to fix a file that has nothing wrong with it.",
    "command": "submit_work {paths:[\"packages/sqlite-process/src/connection.ts\",\"packages/sqlite-process/src/telemetry.itest.ts\"], subject:\"Measure transaction control statements on their own sql.execute spans\"}",
    "expected": "The commit lands: tagma.jsonc is tracked, clean (git status empty, last changed in 652b720335) and parses — the same file had just carried b5a6b8a2d3 ten minutes earlier."
  }
---
Filed from project `runlith`.

Cost: one refused act, a git status/diff/read round to prove the file intact, one retry. At the moment of refusal other sessions were moving HEAD (f5c68238 → c9f34fdc during the window). The declaration reader should read a consistent version (from the commit tree or HEAD) rather than a working file another writer may be replacing, or refuse as transient instead of as a broken declaration.