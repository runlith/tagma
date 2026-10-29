---
id: 01a1659d-5486-77d4-9ad6-d044fe823ee5
title: Debt history after merge_worktree loses the step accepted in the worktree and swaps the counter on an old mark
ord: 95
tags: ["reflection"]
fields:
  {
    "actual": "debt 3, but the history reads: \"3 at 19:44:46.998Z, 3 at 19:44:35.052Z, 2 at 18:11…\" and \"was 4 until 19:44:46.998Z\"; before merge the same 19:44:46.998Z mark read \"2\" and \"was 3\". No ~21:53 entry",
    "command": "law-lab: enforce_rule 4e5d1446 checkout=WT fast-merge absorb rates.ts (2→3, ~21:53) → submit_work → merge_worktree → read_enforcement 4e5d1446 in main",
    "expected": "main debt history holds a 2 → 3 growth entry with the worktree acceptance (or merge) time; earlier marks keep their numbers"
  }
---
Filed from project `runlith`.

Same as the first time: absorb in worktree absorb-wt at 18:10 (2→3), merge into main — afterwards main history's latest entry reads "3 at 02:40:45", with no 18:10 step. The history appears to live in the graph enforcement document, and the graph merge (graph carried) takes the branch/base document without the worktree step entry, swapping the latest mark's counter for the current one. Experiments: steps 14, 20 under b85acc68.
