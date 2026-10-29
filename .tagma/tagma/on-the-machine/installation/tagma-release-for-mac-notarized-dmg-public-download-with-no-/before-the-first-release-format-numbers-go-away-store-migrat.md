---
id: 01a1320b-f658-774d-b6ad-8df84581b954
title: "Before the first release: format numbers go away, store migrations collapse into the baseline"
ord: 5
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
  - kind: relates
    to: 01a12699-1673-714b-a6a5-79e89b246531
  - kind: relates
    to: 01a12699-1673-714b-a6a5-79ed842e3529
  - kind: relates
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
---
Spec section "Migrations before the first release", items 2–4. Waits for lines d86d6647, 9b246531, 842e3529 and removal of their first-run transition doors. Format numbers (`VOCABULARY_FORMAT`, `executions/1`, `WIRE_RANGE`, `InstallationManifest.version`) go away with their own migrations and steps; machine store collapsed, execution host (mechanism or rebuild with recorded loss of history), performance rebuilt; operator updates. Graph steps and journal forms already passed stay in code between releases; deleting and collapsing them is not part of this task.

Release 0.1.0 went to testers before this task ([[1c89545b]]). So the baseline collapses the chain to exactly what 0.1.0 carried (migration list — `stores` in 0.1.0 `release.json`), everything after stays ordinary migrations, and 0.1.0 data forms — format numbers, install manifest `version` — go away through steps that tester copies pass too.

Done: a clean store of each storage is created by one baseline; operator machine and graphs open; 0.1.0 store, graphs and install open; passed graph steps and journal forms kept, cut does not require deleting or collapsing them.
