---
id: 01a129b7-c935-7286-8792-25ff56e7305b
title: submit_work reads an unchanged valid tagma.config.ts as empty JSON
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "refused[commit-step-failed]: tagma.config.ts (tracked) does not declare valid commit steps: JSON Parse error: Unexpected EOF, so nothing was committed; read and git show HEAD:tagma.config.ts confirm the full JSON, read_changes names no holder of tagma.config.ts.",
    "command": "submit_work(subject=\"Type host fixtures and preserve parity checkpoint shapes\", paths=[\"apps/tagma/server/src/executions/testing/hostFixture.ts\", \"apps/tagma/server/src/composition/testing/threads/parity.stest.ts\"], whole=true)",
    "expected": "Land two ready edits with the declared oxfmt commit step; tagma.config.ts in HEAD and the working tree is one valid eight-line JSON, no diff."
  }
---
The read ran in the tagma-holder-impl-f0e304 worktree. The “correct tagma.config.ts” recovery does not apply to an already valid unchanged file; the declaration was not changed and steps were not disabled. This delivery uses one direct git commit of two own paths.
