---
id: 01a16525-7a3d-75aa-b0f2-98d6a38a095f
title: finish_block with a commit that just removed the violation reports “remaining debt” and orders the debt reassigned, which the remeasure drops in seconds
ord: 124
tags: ["reflection"]
fields:
  {
    "actual": "“remaining debt: 4e5d1446 · 1 entries; owner 658ab08b ended” + reassign; the remeasure removed this entry at 19:44:46.998, about 2 s after the answer",
    "command": "law-lab: submit_work 1702bc9b32 (removed console from rates.ts) → at once finish_block 658ab08b commit=1702bc9b32",
    "expected": "finish_block with commit judges debt by that commit (or waits for its remeasure) and never names as remaining the debt the commit removed"
  }
---
Filed from project `runlith`.

The agent's usual order — land and at once finish_block with the commit — makes the false "reassign the debt" the common case. The agent dutifully creates a task and reassigns debt that disappears on its own. The message mechanism from 6a3cd608dc (task 008b6dcc). Experiment: step 19 under b85acc68.
