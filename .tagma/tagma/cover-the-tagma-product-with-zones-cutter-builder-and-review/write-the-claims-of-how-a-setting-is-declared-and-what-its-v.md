---
id: 01a0ca97-13fa-7fdd-902c-112a7e7eac3b
title: Write the claims of how a setting is declared and what its value resolves to
ord: 218
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cad1-120f-7a33-ad4c-4cafe846fa76",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/settings
---
Read `protocol/settings.ts`, `src/settings/resolve.ts`, `graph/core/Settings.ts` and `api/settings.ts`.

Write the claims of [[ec2b42ac]]: what a declaration fixes about a key, which scopes a key may be set at and what a reading of it resolves through, what happens to a key nobody set at any layer, and what it means that the values are blocks of a project's own graph rather than rows of a configuration table.

The claim that a control kind must be declared in the vocabulary, the wire schema and the surface alike — [[5c427eb6]] — stands under the app's settings area with two of its three sources inside this module. Reference it; do not write a second claim over the same three-place declaration.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].