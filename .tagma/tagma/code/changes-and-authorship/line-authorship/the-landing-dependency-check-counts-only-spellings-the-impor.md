---
id: 01a18087-4820-7e26-9807-02fdfddb6fd3
title: The landing dependency check counts only spellings the importer's own binder cannot place
ord: 82
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18081-c193-747f-9800-d762571bfd81",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18081-04c5-787e-aa53-5f6c0f0bc393
  - kind: relates
    to: 01a17d5a-656e-76dc-b53d-177aecccd7e5
sources:
  - kind: file
    ref: packages/code-facts/src/languages/js/symbols.ts
---
submit_work refused `lines-held` naming a peer-added member whose name matched a local binding of the importer (`root`, a local const of linking.ts, against `StealthHold.root` added in serving.ts). The JS symbol reader recorded every non-declaration identifier into `uses`; it must keep only identifiers and members that resolve to an import or to nothing it can see.