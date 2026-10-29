---
id: 01a0cc35-a118-7bff-9a35-f42cf943ca0f
title: apply_batch repeats a bad-document refusal on a file that was corrected after the first refusal
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The second call refused op 2 with the original invalid parentId although rg on the file showed the corrected value; the same document passed inline applied.",
    "command": "apply_batch file=<scratch>/resting-links.json, refused on op 2 parentId; file edited with the edit tool; apply_batch with the same path again",
    "expected": "The corrected file is read at call time and applies"
  }
---
Filed from project `runlith`.