---
id: 01a0ea52-242a-7d03-a15e-38af083e4680
title: submit_work reports refusal after commit and leaves reverse paths staged when git index cleanup loses its terminal
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "Returned refused: 'git ran and how it ended could not be read: git read-tree ended and its console could not be read: terminal-host-refused-UnknownExecution'. HEAD nevertheless held commit c8dfe65d01 with exactly the two moves. The index retained reverse renames from the new paths back to the old paths; the working tree kept the correct new files as untracked. A second submit_work returned 'nothing'. read_terminals showed none held. Narrow checkout_unstage on the four affected paths restored the index and left the landed files intact.",
    "command": "submit_work({subject:\"Move enforcement program and inspection reads into owned areas\",paths:[\"apps/tagma/server/src/enforcement/programs.ts\",\"apps/tagma/server/src/enforcement/programs/run.ts\",\"apps/tagma/server/src/enforcement/reads.ts\",\"apps/tagma/server/src/enforcement/rules/reads.ts\"]})",
    "expected": "Return landed with the commit id and restore the shared index to the newly landed HEAD; if git execution is unreadable, do not report a false commit outcome."
  }
---
Filed from project `runlith`.

Measured recovery cost: read_terminals, a retry, read_changes, git commit/status inspection, read_checkout, checkout_unstage, and final status. No peer paths were unstaged. The first refusal is not proof of no commit: the commit had happened before read-tree cleanup failed.