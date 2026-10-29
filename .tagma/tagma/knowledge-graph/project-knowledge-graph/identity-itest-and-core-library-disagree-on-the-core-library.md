---
id: 01a1353a-0457-7605-8cda-2760c4814df0
title: identity.itest and CORE_LIBRARY disagree on the core library
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a131ea-4ee9-7b17-bdd3-372ebff74df0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a132fb-f271-71b6-a5fa-df0c27cfd1e3
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/tags/identity.ts
---
`composition/testing/graph/vocabulary/identity.itest.ts` ("a type the core library takes over from code-project…") fails at line 175: `shipped.library` differs from the test's expectation. The source is `CORE_LIBRARY` in `graph/contract/wire/tags/identity.ts`. This is a stored-data key, so changing the value is a key migration in graphs, not a literal edit; or the test holds a stale contract. Decide which contract is true and fix the code with a migration or the test. Done when the file passes.
