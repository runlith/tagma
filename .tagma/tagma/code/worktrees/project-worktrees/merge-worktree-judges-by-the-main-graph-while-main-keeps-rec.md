---
id: 01a13a16-f322-7ef4-9099-6f869a0afbb0
title: merge_worktree judges by the main graph while main keeps receiving graph commits, and a branch with new module cards fails
ord: 27
tags: ["reflection"]
fields:
  {
    "actual": "Refusal law-violated with 19 violations: \"the branch and main both changed the graph\", because in the minutes between git merge main and merge_worktree another `tagma: graph @ …` commit from a different session landed in main. Re-taking main, then an operation-in-progress refusal with a clean git status, and only the third attempt passed. Three wasted steps and one false alarm about 19 violations in total.",
    "command": "merge_worktree rootId=01a1370c-9920-7cfd-80d80-909be46be3de (tagma/calls) — right after git merge main in the branch",
    "expected": "A branch that already took main is judged by its own graph; the branch's new module cards and edges are accepted, and the merge passes."
  }
---
Filed from project `runlith`.

Graph commits land in main almost continuously (247650–247652 within minutes), so the "branch holds every main graph change" condition almost never holds for long. Expected: judge by the branch graph when main graph changes since the last take touch no module cards or rules, or take main inside merge_worktree. The operation-in-progress refusal arrived on a tree with no MERGE_HEAD.
