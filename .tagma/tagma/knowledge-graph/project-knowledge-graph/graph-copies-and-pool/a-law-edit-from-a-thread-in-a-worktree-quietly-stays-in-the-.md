---
id: 01a11971-8290-7569-9c35-c75d00675936
title: A law edit from a thread in a worktree quietly stays in the worktree graph copy; the update_block answer never names which copy it wrote
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "update_block answered with only the id and title; the edit landed in foundation-refactor/.tagma, threads on main kept receiving the rule's old text; it took a separate investigation (Sol) to establish that. Later the rule in the worktree copy turned out to be in the trash (read_block: deleted); by whom is not established",
    "command": "update_block 73ef5889 (project rule) from a thread standing in worktree foundation-refactor, on the operator's order to change the project's law",
    "expected": "The answer names the graph copy the act landed in, and the agent sees that the law for threads on main did not change (as the enforce_rule answer does — `graph: …`)"
  }
---
Filed from project `runlith`.

The operator gives orders about the project's law, while an agent standing in a worktree does not know it writes only into that worktree's copy until the merge.
