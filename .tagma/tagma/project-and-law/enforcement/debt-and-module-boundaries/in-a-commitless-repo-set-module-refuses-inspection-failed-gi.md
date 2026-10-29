---
id: 01a15a15-4ebe-75ee-963e-7c10c9a35af1
title: "In a commitless repo `set_module` refuses `inspection-failed` \"git could not say what HEAD is\": the rule court can't do empty history"
ord: 7
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1559e-ac45-73fb-afb6-aae6bacd7de5
---
Found by knowledge-catalog in `modulesDoor.stest.ts`. `world.plainProject` only runs `git init`, while `set_module` now measures rules by HEAD. In a commitless repository that's a refusal with no exit. The test worked around it with an initial commit in the fixture, but the product stayed the same. A new user starting a project in an empty folder gets the same refusal: like `sync_graph` in law-lab (reflection bacd7de5).

**What to do.** At the court owner an empty history is a lawful state. Measuring over a nonexistent HEAD is an empty tree: no violations and no debt, no refusal. Same for `enforce_rule`, `check_rules` and the first commit's landing. First find everyone demanding HEAD.

**Proof:** `set_module` and `enforce_rule` in a fresh `git init` with no commits answer success; the first commit is judged as adding the whole tree.
