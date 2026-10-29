---
id: 01a156ee-85b9-75eb-938d-a1ad20004d73
title: After Tagma restarts on the config build, delete `tagma.jsonc`, `checks/runners.json` and the old `checks/law/program.ts` protocol
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15912-0fdc-71b0-b653-7a8d21b41013",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b087b6f7a4e0
  - kind: waits-on
    to: 01a156ee-85b8-7fb5-ad25-ad08e6563db1
---
Migration item 5 of [[b6f7a4e0]]: this landing may happen only when the operator's server runs on a build that reads `tagma.config.ts`. The operator restarts the server, not an agent. After it comes acceptance item 7 (finding old names).

`program.ts` takes with it everything living only for it: the `inspectMigrations` wrapper in `checks/law/migrations.ts` (the `checks/law/programs.ts` program calls `storedJudge` directly), the `checks/law/reexports`, `swallowed-failures` and `call-services` builtin copies and their branches in `checks/law/checks.ts` (rules judge their builtins), and `effect-style.itest.ts`, `migrations.itest.ts` and `environment.test.ts` move from `inspect` in `program.ts` to the `programs.ts` program. In polygon, `tools/money.js` and `tools/runners.json` go away: the rule judges the `float` key from its `tagma.config.ts`.

Proof: the repository search no longer finds these files and names; the landing passes the gate.
