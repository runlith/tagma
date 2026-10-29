---
id: 01a13085-06e0-71fd-bfc9-29cefc15cf71
title: grep and glob refuse a missing path with no nearest existing directory
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "In thread 01a1307d-b47e-750b-bc32-f9a9cc847191 call #107 answered only \"[grep] error: grep path does not exist: apps/tagma/server/src/change-record/commands\"; three guessed directories gave three errors in 39.435 s, while the valid change-record paths were already in #78. grep.ts:114 and glob.ts:96 give no recovery; read.ts:227–267 looks only at the immediate parent's siblings.",
    "command": "grep {\"pattern\":\"binary|contentOf|record.held|change.held|changes.held\", path:\"/opt/workspaces/runlith/apps/tagma/server/src/change-record/commands\", limit:65}",
    "expected": "The refusal keeps the missing target, names the nearest existing ancestor and a bounded page of its entries, so the next search builds on a read path."
  }
---
Filed from project `runlith`.

In thread 01a1307d-b47e-750b-bc32-f9a9cc847191 call #107 answered only "`[grep] error: grep path does not exist: apps/tagma/server/src/change-record/commands`"; three guessed directories gave three errors in 39.435 s, while the valid change-record paths were already in #78. grep.ts:114 and glob.ts:96 give no recovery; read.ts:227–267 looks only at the immediate parent's siblings.
