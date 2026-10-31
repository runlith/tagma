---
id: 01a193d9-9a1f-79e8-9f71-7a9d791f9689
title: "`Layer.fallback` for replaceable ports, and interface-shaped keys for contract services"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193ea-34a6-7bcc-a27e-687b109d3ef0",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a19371-d439-78c0-9c60-473fd4b30c0c
---
Items 5 and 6 of [[d4b30c0c]]. Settle the semantics under `Layer.when` and deferred chunks first; every key not declared a port stays sealed by `DuplicateProviderError`. The twin `@shop/layer` takes the same mechanism or gets an open task in its project.