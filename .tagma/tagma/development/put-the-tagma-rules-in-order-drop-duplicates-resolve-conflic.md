---
id: 01a18ed9-c489-78ea-8468-637f2f7b2678
title: "Put the tagma rules in order: drop duplicates, resolve conflicts, narrow code-specific prompt rules, check server naming"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d7e-c054-7f63-9b0a-a9ec15aa8591",
    "status": "in_work"
  }
---
A reading of all 207 rules on 2026-10-30 found work in five groups.

- **Duplicates:** rules that repeat Tagma's system prompt or a global rule (31b7d656, f0530b87, 35ff900c, 39721601), and rules that say one thing twice (a9cf196a inside 8dab19b6; e5eed6b8 and af264e00).
- **Conflicts:** 35be02f0, 6dd14633 and 647f2a2b give opposite orders for a Tagma defect met along the way.
- **Prompt reach:** 14 prompt rules concern particular code but ride every thread's startup.
- **Unmeasured law:** 931cfbf1 is the `names` builtin's checks written as text, while the `names` key enforces only the 700-line ceiling.
- **The package contract rules created on 2026-09-22** are handled by the child tasks.

Delivery `finding` for rules whose check catches every breach is a later step, once the running server carries it.