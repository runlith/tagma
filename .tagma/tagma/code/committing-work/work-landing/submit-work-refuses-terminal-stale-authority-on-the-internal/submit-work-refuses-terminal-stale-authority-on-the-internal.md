---
id: 01a12a23-a4ae-700e-8d55-48859fb43e64
title: submit_work refuses terminal-stale-authority on the internal git rev-parse, and the same call passes on retry
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "refused: git diff-tree ... could not be read: terminal-stale-authority; the same call passed right after. Third time in the session, now on diff-tree",
    "command": "submit_work({ paths: [candidate.itest.ts, hostChange.stest.ts] })",
    "expected": "The landing follows a fresh read"
  }
---
