---
id: 01a0d55b-288e-764a-91b0-724667286c7c
title: "Extract `@runlith/code-facts` from `package-boundary`: import reading, resolution over a tree, `floorCrossings`"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d55c-c579-7af1-8fb8-1c21cd965c81",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d4db-9d5e-79cd-95d5-c098982f1bca
sources:
  - kind: dir
    ref: packages/code-facts
---
New kit `packages/code-facts`: `parseImports` moves from `package-boundary/src/imports.ts`; `resolveRelative` resolves against a tree port with `resolveLocal`'s candidates in its order; `floorCrossings(edges, floors, siblings)` answers crossings with file, line and specifier. `package-boundary` reads through it, and its `floorViolations` becomes `floorCrossings` plus its own debt filter. Done when every package's `boundary.test.ts` and `package-boundary`'s tests pass unchanged, the kit has its own boundary test, and crossings from a git tree equal `readPackageBoundary`'s over the server's non-test sources ([[982f1bca]] acceptance).