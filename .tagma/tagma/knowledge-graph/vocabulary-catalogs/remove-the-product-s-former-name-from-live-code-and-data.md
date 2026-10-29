---
id: 01a14680-6d66-7e73-8fad-a19337bd006d
title: Remove the product's former name from live code and data
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1467f-bc34-7f8e-bf09-2bbba0d2b41f",
    "status": "done"
  }
---
Move graph contracts and the catalog into the `core` namespace, remove the product's former name from app code and rules. When a new build opens, the graph's structural ids and `graph.catalogs` values change once; user prose stays unchanged. Former migration inputs and native recordings persist as historical data. The operator restarts the server. Check: the owners' narrow tests, package typecheck, and a search for remaining uses outside the frozen archive.
