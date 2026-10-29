---
id: 01a13135-69be-7895-b030-9a29fe7a2454
title: A new worktree's graph branch is cut from a stale sibling graph line instead of the current graph of its base branch
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "Its graph branch descends from a line forked on 2026-09-30 (merge-base 3011fe57, commits from 2026-10-01 to 10-02) that it shares with two sibling graph trees. Release has none of its 14 commits, and it lacks 84 of release's. So it re-merged five branches release had long since absorbed, and the last of them conflicted.",
    "command": "Worktree `feature-a` (rootId 01a11b34-395b-76a6-8ad3-7aabda754dec) created 2026-10-08 from release at 96598ba4, in another project",
    "expected": "The graph branch of `feature-a` starts from the graph of release at creation time (29210493 on 2026-10-08, already migrated and already containing the merged branches)."
  }
---
Measured in the project's graph trees: `git merge-base --is-ancestor 7b5153ab HEAD` holds for `feature-a` and two sibling trees and fails for release. The code branch had no commits of its own (ahead 0 against release). By its code the whole branch was already in release, but its graph ran 12 days behind.