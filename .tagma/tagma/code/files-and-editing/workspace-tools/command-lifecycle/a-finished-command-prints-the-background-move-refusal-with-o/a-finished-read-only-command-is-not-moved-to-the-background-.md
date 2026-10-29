---
id: 01a13f69-7cbe-7ea5-8059-be8b1da2c2ba
title: A finished read-only command is not moved to the background because of owes nothing
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The diff was delivered, but shell_metadata reports: «Its wait passed and this call could not move it to the background: This installation owes nothing for b4fa9a66-9ef4-4a9e-89e8-bf15c468db1c; a mode moves only while its obligation stands.; it was held here until it ended.»",
    "command": "bash({command:\"git diff -- apps/tagma/server/src/change-record/holdings/inputs.ts apps/tagma/server/src/change-record/holdings/judge.ts apps/tagma/server/src/change-record/holdings/restore.ts apps/tagma/server/src/composition/testing/change-record/revertLines.stest.ts\",waitMs:1000,lifeMs:10000})",
    "expected": "The command answers the diff or a standard background-execution reference after waitMs."
  }
---
Filed from project `runlith`.
