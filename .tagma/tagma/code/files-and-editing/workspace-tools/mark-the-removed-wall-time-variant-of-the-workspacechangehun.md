---
id: 01a17b65-4db0-71e5-844d-f03596be3bbc
title: Mark the removed wall-time variant of the workspaceChangeHunk complexity check
ord: 58
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b5c-c538-7f61-b931-a24eb256ca9b",
    "status": "done"
  }
---
cac5acb removed the variant of 100 calls with 1000 repeated lines and a 2000 ms ceiling from `packages/agent-tools/src/WorkspaceChanges.test.ts`. The owner `packages/files/src/hunk.ts` takes lines and yields no read counter; the existing `WorkspaceChanges.test.ts` and `packages/files/src/hunk.test.ts` check hunk minimality, uniqueness, and applicability, but not complexity. That timing variant is removed with no equal coverage; no test counter or seam is added for it.
