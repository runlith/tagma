---
id: 01a14c4b-738c-7f0f-bcaa-f86a2ba1bf08
title: A schema-typed tag field prints the value's accepted form in every door naming it
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c3f-5402-7694-bf65-292de25e1cea",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/declarationRules.ts
---
The agent saw only the schema name (`layout (viewLayout)`) and could not fill the field without Tagma sources. The form is declared beside the schema in the `FIELD_SCHEMAS` registry and prints in the tag's start-dictionary row and `read_tags`, in `read_vocabulary` (`forms`), and in the `field-invalid` refusal. Proof: a unit test of the refusal with a form and a live check on its own `tagma:try`, where a fresh agent in a project without Tagma sources creates a #view with a board by status on the first attempt.
