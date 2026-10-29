---
id: 01a18751-c0e0-7bd7-a27a-1d6bd4c18c15
title: merge_worktree in a stealth-graph project judges the module map by the base's graph, so a branch that adds modules can never merge
ord: 151
tags: ["reflection"]
fields:
  {
    "actual": "Refused rule-violated with 48 crossings, all of them modules or relations the branch graph declares (packages/virtual-list, packages/e2e unowned; composition → chat-ui tests); the same refusal after resolve_graph_conflict published the merged branch graph",
    "command": "merge_worktree(rootId: feed-e2e worktree, mode: merge) in project tagma (storage stealth) after the branch's graph took main's graph",
    "expected": "The merge judged by the module cards the merge lands (the branch graph, which already holds main's), as the tool does for in-tree graphs; check_rules over the branch finds no new crossing of 083d37f1"
  }
---
Filed from project `tagma`.

The tool description says the base checkout's graph judges when the graph is stored apart from the tree. The base graph cannot hold the new module cards until this same merge lands them, so the only exits offered are absorbing false crossings as debt or editing the base graph ahead of the merge. check_rules over: all on the feed-e2e checkout at 0ba2b11b with the merged graph c7008052 answered only the 19 standing host-composition escapes main already records.