---
id: 01a128cd-4189-7b5f-aba0-1ab079b73607
title: submit_work names paths with no diff from HEAD as this session's uncommitted lines
ord: 118
tags: ["reflection"]
fields:
  {
    "actual": "Landed 68967c1edf, yet answered that lines of this session still stand uncommitted in packages/utils/src/codec.test.ts (created then deleted with the delete tool), packages/utils/src/codec.ts and packages/utils/src/json.ts, while `git status --short packages/utils` is empty. Same three paths were listed after the earlier landing 14230e63a5.",
    "command": "submit_work checkout=/opt/workspaces/runlith paths=[packages/utils/src/codec.ts]",
    "expected": "After landing, `left` names only paths where this session's lines differ from HEAD; a file created and deleted by the session, or edited back to HEAD, is not held."
  }
---
Filed from project `runlith`.