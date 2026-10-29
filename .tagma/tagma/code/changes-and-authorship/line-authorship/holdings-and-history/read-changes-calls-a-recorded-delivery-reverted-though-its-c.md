---
id: 01a16e35-ed6a-7ee0-bb94-84c374ba9671
title: read_changes calls a recorded delivery reverted, though its commit is reachable from HEAD
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The rolloutDrill.itest.ts delivery is named withdrawn (reverted), commit 08110423b7 not shown; git confirmed its reachability from HEAD and the clean working file.",
    "command": "read_changes({\"limit\":50})",
    "expected": "Lines recorded by submit_work show as committed with the reachable commit; an unfinished judging issues no final reverted."
  }
---
Filed from project `runlith`.

submit_work answered 08110423b7b8423f897cfdbdca640fb95c4d6542 for apps/tagma/server/src/composition/testing/threads/rolloutDrill.itest.ts. Right after it read_changes showed 0 held paths, judging 1, and withdrawn (reverted) for that delivery. git merge-base --is-ancestor 08110423b7 HEAD exited 0; git status and git diff HEAD for that file are empty. A repeated read showed judging 3 but the same final reverted mark and no commit in the list. The read also names the rewind.itest.ts deletion reverted, though commit 2b3399f4b3 carried it.
