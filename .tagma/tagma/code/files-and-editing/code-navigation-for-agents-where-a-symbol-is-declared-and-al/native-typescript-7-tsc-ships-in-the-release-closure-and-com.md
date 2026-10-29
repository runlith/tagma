---
id: 01a16195-ccd3-7df9-bddb-516ed374a242
title: Native TypeScript 7 tsc ships in the release closure, and composition passes its path to the navigation engine
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16167-afd2-77b1-bc67-9aa426ed792e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16160-39ce-7163-bb84-009b753b9d92
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
The native `tsc` of TypeScript 7 ships in the release closure, and composition passes its path to the navigation engine.

The navigation engine process (`@runlith/navigation-ts`, `engineProcess.ts`) is bundled separately next to the server one, but the platform `tsc` binary of the TypeScript 7 package does not land in the install: the `typescript/async` client looks for it through `node_modules`, which the install has none of. The platform binary must be carried into the release closure like ripgrep (`installation/cut/release.ts`, `installation/closure/carried.ts`), and its path passed to `launcherLayer({ compiler })` in composition; without it, the engine in the install does not start (`EngineLost` from `open`).
