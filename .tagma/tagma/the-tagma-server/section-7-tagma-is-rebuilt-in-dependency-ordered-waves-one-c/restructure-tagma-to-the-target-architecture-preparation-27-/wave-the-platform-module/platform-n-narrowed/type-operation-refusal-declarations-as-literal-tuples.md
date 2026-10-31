---
id: 01a0e9e1-2b67-706e-b6b3-dd758fec4b30
title: Type operation refusal declarations as literal tuples
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0e532-c800-7165-9b26-b219ffbe9620
---
`EveryRefusal` currently indexes refusal lists assembled from the operation catalog, so a per-file S8 reader cannot prove their literal-code union. Make `OperationDeclaration.refusals` retain each declaration's literal tuple, including an empty list, through `operation()` and catalog composition; typecheck the server and the declared operation surface. A later cross-file names reader can then prove the derived type and retire the exact `EveryRefusal` exception through `enforce_rule`.