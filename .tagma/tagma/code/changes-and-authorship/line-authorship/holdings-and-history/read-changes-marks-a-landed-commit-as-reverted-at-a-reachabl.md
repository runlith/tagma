---
id: 01a16ecd-a711-7e32-a6c2-9ad86599e2be
title: read_changes marks a landed commit as reverted at a reachable HEAD
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "It returned only the previous commits, and named eight paths from the just-finished submit_work 98b09e8bde withdrawn (reverted); the following git merge-base --is-ancestor 98b09e8bde HEAD exited 0, git status of those paths is empty, the reflog shows further ordinary landing/graph commits.",
    "command": "read_changes({\"limit\":20})",
    "expected": "Show 98b09e8bde among the landed commits and its eight paths as committed, keeping the separate uncommitted closing.test.ts line."
  }
---
Filed from project `runlith`.

Submit_work call_2b59ef0f37ce4fbe8c48c5f7e524cdf8 answered 98b09e8bde · 8 paths; right after it git ls-files confirmed the paritySessions deletion, and git show displayed the full commit. Then read_changes wrongly assigned contract/service/copies.ts, protocol/copies.ts, copies.test.ts, asides.ts, driver.ts, protocolRoad.itest.ts, and paritySessions.itest.ts to reverted, and lifecycleWorld.ts to the earlier ac1595e. A bash check after the wrong read gave ancestor exit=0 on HEAD c5b0a0b288 and showed no changes in those paths; I invoked no reset/revert. That is a change-record judgement defect, not proof of lost bytes or a git rollback.
