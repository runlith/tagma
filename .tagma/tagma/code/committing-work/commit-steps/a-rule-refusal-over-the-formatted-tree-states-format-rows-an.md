---
id: 01a16520-c25f-7fe0-a260-bdc788ccb5a3
title: A rule refusal over the formatted tree states format rows and numbers, but the agent's working file doesn't hold them and never learns the formatter gave them
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "Refused rule-violated: “packages/domain/src/expenses.ts:1 holds 125 rows outside its imports, over 120”; the working file stays 86 rows, the word format in no refusal; check_rules says the same",
    "command": "law-lab: prettier format in tagma.config.ts; in expenses.ts (86 rows) one long object row added; submit_work",
    "expected": "The size refusal says the violation arose in the shape the format command prettier gave (the file after formatting — 125 rows, now 86), or the working file gets the formatted text, as on a successful landing; the violation place matches what the agent sees"
  }
---
Filed from project `runlith`.

Rules judge the tree after format commands (as designed), but the refusal doesn't tie the number to the formatter. The agent sees 86 rows at "125" and doesn't know what to cut. Same for any numbered violation (eslint, loads) after the formatter moved rows: `file:line` points at a formatted-version row that isn't in the working file. Experiment: step 18 under b85ac68.
