---
id: 01a13fce-a146-7f42-8015-2204da1d3baa
title: "`modules` judges a commit that only changes the resolution config outside region"
ord: 32
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13f95-60fe-7047-a344-e33f81074aa9
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/declaration.ts
---
`modules` rule `relevant` accepts a change when the path lies in region, is a `package.json`, or is a path from `built`. A resolution config outside region — `apps/tagma/app/tsconfig.json` under a card at `apps/tagma/app/src/lib/...`, the root `tsconfig.base.json` referenced by `extends` — changes where region files' imports land, but a commit changing only it is never judged by the rule: the gate lets it through, and the violation surfaces only at the next full measurement.

To do: the rule judges changes to any resolution input recorded by its region's importers (`inputs` in the importer index), not just paths from the static name list. Verification: a commit changing only an out-of-region tsconfig so that an importer's alias moves into someone else's private is refused at the gate.
