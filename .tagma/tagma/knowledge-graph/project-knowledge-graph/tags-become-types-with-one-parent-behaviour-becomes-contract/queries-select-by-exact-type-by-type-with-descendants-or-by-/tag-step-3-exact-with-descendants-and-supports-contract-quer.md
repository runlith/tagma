---
id: 01a0f4aa-02e3-710b-ba47-d375b9a417cc
title: "Tag step 3: exact, with-descendants and supports-contract queries; saved selectors and gates migrate as exact"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f539-0951-7817-a4ab-c77748c8d1a4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f483-46b8-77f8-9b43-a7933a1439e4
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/query.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/tags/selector.ts
  - kind: file
    ref: apps/tagma/server/src/graph/search/ranking.ts
  - kind: file
    ref: apps/tagma/server/src/graph/search/selection.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/naming.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/tagIndex.ts
---
Builds [[3a1439e4]] using the available resolver and compiled descendants. The query owner also supplies the shared exact/descendants/support selector and the compiled contract-support index; descriptor expansion remains with contracts. Preserve legacy saved selectors and open-child gates as exact, while new references pin permanent ids. Connect public queries and catalog profile selectors to the same semantics. Complete after public fixture operations establish unchanged legacy sets and the three distinct subtype selections. Assigned to Astra high under [[6ccec00a]].