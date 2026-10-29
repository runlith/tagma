---
id: 01a128e1-a0e9-7e15-b0b0-914592f818fd
title: write loops recovery for a new file in a missing directory
ord: 70
tags: ["reflection"]
fields:
  {
    "actual": "Two consecutive calls answered identically: 'cannot be established as the resource this call was allowed over. Call it again so it is resolved and allowed together'. The retry by recovery created nothing; no separate directory-creation operation was offered.",
    "command": "write path=/opt/workspaces/runlith/apps/tagma/server/drizzle/20261011025400_retirement_proof/migration.sql content=<CREATE TABLE retirement_proof SQL>",
    "expected": "One call creates the file in the new directory or answers with an actionable recovery that creates the parent directory."
  }
---
Filed from project `runlith`.

The first call was retried exactly by the refusal's instruction. The new migration directory is needed for an authorized phantom-held fix; the path is inside the current main checkout. The next direct workaround is creating only the directory with mkdir and returning the original write.
