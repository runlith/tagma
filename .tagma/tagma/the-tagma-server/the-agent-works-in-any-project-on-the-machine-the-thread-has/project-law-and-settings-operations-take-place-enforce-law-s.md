---
id: 01a135fa-ecba-7290-aa5f-e682762f1514
title: "Project law and settings operations take place: enforce_law, set_module, write_setting, and their reads work in another project"
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a135f9-b1a2-7637-ae25-edabcbf01f62
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
---
Project law and policy operations do not take `project`, so a thread from runlith cannot place a gate, module, or setting in another project: `enforce_law`, `read_enforcement`, `read_inspections`, `set_module`, `write_setting`, `read_settings`, `read_commit_steps`, `set_project_policy`, `read_project`. Measured on the live server after merging `9beade9120`: of 347 operations, 110 carry `project`; the listed ones do not. `check_law` selects the place via `checkout` — that is already a place.

Worse than absent: `tagma op write_setting` from cwd `/opt/workspaces/polygon` answered `ok` and wrote the setting into runlith, the thread's home, without naming the project in the response (reflection `e95c70f1`). An act with an explicit copy of one project silently writes another.

Do: these operations declare `place: true` and receive the place from `invocation` like the rest; a write response names the project. A CLI call from a foreign checkout's cwd either takes the place by cwd like a command does, or refuses `place-mismatch` — never silently writes the home.

Proof: integration test on two projects — `write_setting` and `enforce_law` with `project: B` from thread A change B, A untouched; `set_module` in B is judged by B's modules.
