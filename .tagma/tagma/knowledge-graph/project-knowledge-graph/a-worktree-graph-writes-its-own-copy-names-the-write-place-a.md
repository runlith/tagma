---
id: 01a12c8b-46e8-73ef-9ae8-4ac5a87bc986
title: A worktree graph writes its own copy, names the write place, and resolves the graph's git conflicts
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c8a-a6f5-7ca4-8351-a0667bda6f35",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e9ff-9b38-73de-9c32-49f722c440cc
---
Fix routing of writes and reads into the checkout's graph copy, the answer's copy address, resolution of team-graph git conflicts, and the stale git index at the graph and invocation owners. A checkout's graph follows its git branch for every tag; main takes changes by merge. Finishing a shared merge commit through submit_work stays a separate question.

Implemented: default HTTP/MCP route by thread place, `graphCopy` in write answers, local source-worktree reflections, committing the answer on its branch, a cursor with the copy address, validation and staging of the checked snapshot of graph conflicts without manual git add, saving conflicts and staged code, and restoring a stale index at working=HEAD. Review: Sol xhigh and two Muse xhigh lenses; confirmed findings fixed. Last independent owner checks: 33 pass, including marker-size=3 and orphan refusal before the index change. On a separate tagma:try 5861 passed six contracts: copy address, enforcement isolation, stale index, main link address, resolution address, and open-merge saving. Before the last findings, rules/updates/reflections isolation system checks and both recovery paths passed; their last repeat on the shared tree stopped while loading providers with `SyntaxError: Export named 'OAUTH_PROVIDERS' not found`. The last typecheck named no errors of these changes but failed on errors in others' changing files — providers, change-record and execution-host. Those zones were untouched by this work.
