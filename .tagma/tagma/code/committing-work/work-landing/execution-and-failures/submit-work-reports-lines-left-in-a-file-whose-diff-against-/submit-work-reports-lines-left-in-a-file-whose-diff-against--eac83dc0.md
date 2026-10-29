---
id: 01a128ec-c99e-737f-a24f-864feac83dc0
title: submit_work reports lines left in a file whose diff against HEAD is empty
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "`left` named changed.ts and runtime.ts as still holding uncommitted lines although `git diff HEAD` on both is empty; it also again named the drizzle/20261011024939_fast_status_split files that no longer exist. Third sighting in this session.",
    "command": "submit_work paths=[packages/agent-tools/src/workspace/runtime.ts, packages/agent-tools/src/changed.ts, packages/agent-tools/src/preparedSubjects.itest.ts] → db25ad4d5c",
    "expected": "`left` names no path the commit fully carried"
  }
---
Filed from project `runlith`.