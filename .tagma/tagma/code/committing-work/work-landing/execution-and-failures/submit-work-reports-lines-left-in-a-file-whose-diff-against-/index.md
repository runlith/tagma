---
id: 01a128ac-d6dd-7d76-b1b8-e03043547a97
title: submit_work reports lines left in a file whose diff against HEAD is empty
ord: 21
tags: ["reflection"]
fields:
  {
    "actual": "Both landings answered `apps/tagma/server/src/platform/git/ownGit.ts — lines of this session still stand uncommitted`, while `git diff HEAD --stat -- ownGit.ts` printed nothing right after. I had to check by hand twice whether the commit was complete.",
    "command": "submit_work paths=[packages/git/src/Git.ts, apps/tagma/server/src/platform/git/ownGit.ts, apps/tagma/server/src/workspace/contract/wire/settings.ts] (commits fd634a4082 and 3e124cb3cb)",
    "expected": "After landing, `left` names no path where `git diff HEAD -- <path>` is empty"
  }
---
Filed from project `runlith`.