---
id: 01a127f0-b368-7fbf-ae46-f6f97d07185e
title: omittable, canonicalJson as JSON.stringify, and defaults via ?? at the owner
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
sources:
  - kind: file
    ref: packages/executions/src/executionSpawner.ts
  - kind: file
    ref: packages/utils/src/object.ts
---
Steps 1–3 of the spec: `omittable` in `@runlith/utils/schema`, `canonicalJson` as `JSON.stringify`, defaults via `??` in `annotated` (`packages/executions/src/executionSpawner.ts`).

Start with an audit of the owners of stored digests from `canonicalJson`: whether their input can carry `undefined`, and what to recompute if it can.

Done when: the spec's contract tests for `omittable` and `canonicalJson` are green; `utils` depends on `effect` and exports `./schema`; `imports` edges from the modules that start importing it to `utils` are recorded via `set_module`; typecheck and tests of `utils` and `executions` are green.
