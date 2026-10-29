---
id: 01a1502d-e20f-7441-9d9e-cf6ed44de945
title: The frontend skill describes the refactor-introduced environment as existing and points at the fixed files
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14fe9-0c9d-7495-b939-a9c9d4d43375",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14fd8-3e41-7f9d-909a-f909b96e483e
sources:
  - kind: file
    ref: .agents/skills/frontend/SKILL.md
---
Task 7 of spec [[b96e483e]]. Refactors [[09386eb6]], [[41d18ce7]], [[1ee3393f]] have landed (bca55ac8b7, be679bfc8e). Move from the "Being introduced by the refactor" section into the main text of `.agents/skills/frontend/SKILL.md` what is now in the code, checking each statement against the source (names may have differed from the plan: `X.optional()`, `Host.apple`, `SystemSettings`, `BrowserWorkers`, etc.); leave what is not built marked or remove it; point examples at the fixed files. Proof — the skill's commit.
