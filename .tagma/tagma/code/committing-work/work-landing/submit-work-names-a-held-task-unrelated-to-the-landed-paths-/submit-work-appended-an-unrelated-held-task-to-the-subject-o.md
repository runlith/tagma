---
id: 01a1757a-c0d8-7067-ab93-b6bb6395b1f4
title: submit_work appended an unrelated held task to the subject of a skill commit
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "Commit 2ac05b0d94 landed as \"… with a 10/10 fix gate (0ba1933d)\" and the answer suggested finish_block 0ba1933d with it.",
    "command": "submit_work paths [\".agents/skills/fundamental/SKILL.md\"] subject \"Add the fundamental skill: …\" while this session holds 0ba1933d (inherited from a stopped child)",
    "expected": "The subject stays as given: the skill file has nothing to do with the held task."
  }
---
Filed from project `runlith`.