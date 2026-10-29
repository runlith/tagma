---
id: 01a16491-3485-72d0-828b-01e9d7c9afe2
title: Merge after absorb and submit sometimes misses the branch debt until an extra graph read
ord: 144
tags: ["reflection"]
fields:
  {
    "actual": "First full native run after the scope ids fix: absorb and submit succeed, merge refused rule-violated on the same fingerprint; adding read_enforcement worktree (assert debt=1) before merge gave a green run. Cause not yet established.",
    "command": "bun test --parallel=1 ./src/composition/testing/enforcement/absorbCheckout.stest.ts (cwd=/opt/workspaces/runlith/apps/tagma/server)",
    "expected": "After a successful native absorb, sync_graph worktree and submit_work, merge_worktree judges by the branch's carried graph and lets the accepted debt through with no extra read."
  }
---
Filed from project `runlith`.

The debt owner is created after branching via native create_block(checkout=worktree,parentId=rule), so the rule module card becomes index.md under a directory with a child. sync_graph runs after absorb and after submit. Unproven whether the refusal comes from the rule file move, the freshness of the merged graph, or debt remeasurement; the extra read is not a fix.
