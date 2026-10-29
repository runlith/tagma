---
id: 01a16526-d556-7f04-9e2e-473ea71a2a5a
title: "merge_worktree merges a branch without the worktree's unsynced graph: merge judges debt accepted in the worktree as debt, but it arrives in main as a slipped-through violation"
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "merged 0204275 with no refusal; at merge time WT had `M .tagma/law-lab/console/index.md` (debt); the WT graph was committed only AFTER the merge (04ed0bf \"graph @ 3\") and never reached main; in main debt 2, escaped 1: budget.ts:19 @ 2fd9e1ff79; the owner task is in main",
    "command": "law-lab worktree both-graphs: create_block checkout=WT (04d86b08) → enforce_rule checkout=WT absorb budget.ts (debt 2→3, WT graph) → submit_work WT (2fd9e1ff79) → merge_worktree 01a16524-948b-786b-a408-55e58012689a at once; main also changed its graph after branching",
    "expected": "merge carries the worktree graph together with the accepted debt (first delivering its pending graph, like sync), or refuses while the worktree graph is uncommitted; in main a debt entry for 04d86b08"
  }
---
Filed from project `runlith`.

Step 14 (absorb-wt) did not show this: minutes passed between absorb and merge and the graph autocommit made it (8321e30). Here merge runs seconds after submit_work. The merge gate did not refuse even though the branch's committed graph held no debt — so it judged a different graph than the one that arrived. Experiment: step 19 under b85acc68.
