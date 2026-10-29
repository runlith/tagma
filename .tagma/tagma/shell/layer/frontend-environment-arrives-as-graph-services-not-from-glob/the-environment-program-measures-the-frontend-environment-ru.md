---
id: 01a15033-c745-75fe-a331-acf11d73cd66
title: The environment program measures the frontend environment rule, and it is switched on at the gate
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14fd8-af83-7c0e-8512-fdff947e6227",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14fd8-3e41-7f9d-909a-f909b96e483e
  - kind: relates
    to: 01a15033-a613-7d2d-beee-2f1c999bf9fa
sources:
  - kind: dir
    ref: checks/law
---
Task 6 of spec [[b96e483e]] in the shape of a single rule [[999bf9fa]] (on the operator's word — one rule instead of the audit's six [[dbf104d3]]). Write the `environment` program in `checks/law/` on the `runlith-law` runner (`checks/runners.json`), next to `ui-tokens` and `effect-style`: parameters — globals and imports, each with allowed files and a reason; finds free touches of globals, including through `window.`/`globalThis.`/`self.`, not mistaking a local binding of the same name, and direct imports of the specifier (`$app/navigation`, `$app/state`); the fingerprint is file × name. The allow-list — from the final code after be679bfc8e and the audit's exclusions. A minimal test on real examples. Then `check_law` with an unsaved inspection on HEAD, triage of each finding (bypass — fix at the owner or as debt on a task; legitimate — onto the list with a reason), and `enforce_law` on gate with a pre-`submit_work` trigger. The `frontend` skill names the rule in "Don't". Proof — the program commit and the recorded enforcement document.
