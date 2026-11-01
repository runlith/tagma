---
id: 01a193d9-9a1f-79e8-9f71-7a9ea7bad9bb
title: One route umbrella renders contributed surfaces, and the root is one overlay with an exports map
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193ea-34a6-7bcc-a27e-687b109d3ef0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a19371-d439-78c0-9c60-473fd4b30c0c
  - kind: waits-on
    to: 01a193d9-9a1f-79e8-9f71-7a9c2a8efe49
---
Items 7 and 8 of [[d4b30c0c]]: generalise `routes/[project]/p/[app]/[view]`; `surfaceConfig({ runtime, sources })` replaces each root's plugins; `@tagma/app` exports its points, contribution types, composition entry and UI kit.