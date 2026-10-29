---
id: 01a0ea7d-7c53-77a5-8bb8-2a0439aa5706
title: enforce_rule replaces a rule's whole inspection document with no base revision, so two waves adding floors concurrently erase each other's entries
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "The later write silently replaced the list. wave-landing's four new floors (thread-record, workspace, executions, worktrees wire) vanished under a peer's write that added settings and native-harness floors, and were found missing only on read-back.",
    "command": "tagma op enforce_rule on rule f49f228f from worktree `restructure`: several agents each read the floor list, added their floor, and submitted the full list",
    "expected": "A write built on an older document than the one standing is refused as stale, or the act merges one added entry instead of replacing the list."
  }
---
Filed from project `runlith`.