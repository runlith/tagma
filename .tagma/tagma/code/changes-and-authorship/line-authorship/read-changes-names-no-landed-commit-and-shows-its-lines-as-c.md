---
id: 01a16e30-3d13-7864-94ce-e633a29b1817
title: read_changes names no landed commit and shows its lines as cleared
ord: 102
tags: ["reflection"]
fields:
  {
    "actual": "The reading named only 684d509 and marked the new lines of all.ts, all.itest.ts, suites.ts, check.ts, and packages.ts as cleared; git merge-base --is-ancestor 03a2cbe73e HEAD returned 0.",
    "command": "read_changes({limit:40})",
    "expected": "After the submit_work that returned 03a2cbe73e, the session reading names that HEAD-reachable commit and the related entries as committed."
  }
---
Filed from project `runlith`.

submit_work returned 03a2cbe73e with seven paths, carried lines vitest-speed, and five format-rewritten files. During the landing my background test:all kept running; the working tree holds no new lines, the commit stays an ancestor of HEAD. Verified with separate git merge-base and git show: 03a2cbe73e Share Vitest discovery and retain interrupted test costs (ff12c6b8).
