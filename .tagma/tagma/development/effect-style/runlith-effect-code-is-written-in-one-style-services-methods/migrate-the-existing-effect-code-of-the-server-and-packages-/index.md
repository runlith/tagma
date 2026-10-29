---
id: 01a13b76-3d46-78eb-b352-1c34449dfe0d
title: "Migrate the existing Effect code of the server and packages to the recorded style: the effect-style rule debt leaves module by module"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13ad9-62d0-709e-8021-29b44a8e3ed8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
---
The owner of the Effect style rules' debt, recorded when they were enabled. Migration goes module by module: a module's production code and its tests together, tests on `@runlith/effect-test`, the shape from the `effect4` skill's "How Effect code is written here" section. One task with one runner migrates a module; on handoff its debt moves to that task. Proof is the module's empty rule debt, `bun run typecheck` and the module tests green. Migration runs by hand; after an already applied automatic migration, its runner fully re-reads every changed file and their diff, checks semantics and architecture, and fixes the result by hand before handoff.
