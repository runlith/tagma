---
id: 01a165a1-3c50-7944-837c-d84b8deaecb2
title: Tightening a check in tagma.config.ts cannot be measured over the whole reach before landing, and landing silently creates slipped violations
ord: 133
tags: ["reflection"]
fields:
  {
    "actual": "over change: \"no violation\" (judges only changed files); over all: measures the HEAD config (limit 120, \"holds 192 … over 120\"); submit_work landed without a word; ~10 s later remeasure recorded 2 escapes @ 6f29b791cd (seed.ts 56 > 50, expenses.ts 83 > 50)",
    "command": "law-lab: tagma.config.ts size 120 → 50 (uncommitted); check_rules over change; check_rules over all inspection=size blockId=54911d80; submit_work",
    "expected": "there is a way before landing to see what the new config finds over the whole reach (the rules skill advises just that: \"measure the new description with check_rules first\"), and landing names how many slips it will create"
  }
---
Filed from project `runlith`.

over change: "no violation" (judges only changed files); over all: measures the HEAD config (limit 120, "holds 192 … over 120"); submit_work landed without a word; ~10 s later remeasure recorded 2 escapes @ 6f29b791cd (seed.ts 56 > 50, expenses.ts 83 > 50).

The skill's advice is unfulfillable: no door measures the whole reach with an uncommitted config. An agent tightening a rule learns the consequences only after landing, and cannot absorb in advance. Experiment: step 21 under b85acc68.
