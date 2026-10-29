---
id: 01a156ea-c610-782c-8954-90b16bb9bbf2
title: An operation contract declares the place shape and each subject field's role; admission derives place from subjects
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1565c-47b9-7ff2-bfd3-246b13adade8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15666-29d3-7512-8c0c-71e28fa6e159
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/place.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/place.ts
---
To do: a mandatory `place` in the operation declaration, the field's role in the schema annotation (subject kind, mention, value), resolution of kinds by their owners through the manifest, the place-picking order in `operationFacts`, the environment project kept apart from the explicit one in `admitProject`, entry into someone else's place by the place's project rather than by the `project` field. Translate the whole catalog: every declaration gets a shape, every subject field a role; `project` stands exactly where the subject may be left unnamed. Start with `platform/contract/wire/place.ts` and `invocation/admission/place.ts`.

Proof: a unit check of the catalog (every field with a subject-like name carries a role, `project` follows the shape, every kind has a filler) green across the whole catalog; the server typecheck passes.
