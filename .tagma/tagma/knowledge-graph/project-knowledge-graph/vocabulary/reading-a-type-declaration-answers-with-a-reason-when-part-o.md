---
id: 01a13cce-91f8-77b3-81de-8876efc6a9fe
title: Reading a type declaration answers with a reason when part of the declaration is unreadable
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13c96-169d-7590-9735-bcaf64ef0ba3
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/vocabulary/declarationRules.ts
    symbol: declarationOf
  - kind: symbol
    ref: apps/tagma/server/src/graph/vocabulary/layers.ts
    symbol: textOf
---
Reading a `#tag` node's type declaration silently loses whatever did not read — rule ea465bed holds two debt places here.

- `declarationOf` (`graph/vocabulary/declarationRules.ts`): a declaration part (`fields`, `edges`, `roles`, `gates`, `sections`, and others) that does not decode with its schema reads as missing. The type assembles without it, and the reader sees a type with no fields or roles, never learning they are recorded but unread.
- `textOf` (`graph/vocabulary/layers.ts`): a declaration that does not compose yields `null` instead of a prompt. Comparing with the installed base (`sameDeclaration`, parsing the local layer) then says "texts differ" or "nothing to compare" with no reason, and the layer conflict names nothing broken.

A rework is needed: declaration reading returns either a `Declaration` or a refusal with the part and reason, and its consumers (tag-table assembly, `layers`, catalog install) decide on that answer — switch the type off with a named reason or refuse the act. Now `declarationOf` has no error channel, and it is called synchronously from table assembly, so this is separate work, not a mechanical edit.

Done when both places have left the ea465bed debt and a declaration with an unread part is visible to the reader with a reason (a table-assembly test and a layer-conflict test).
