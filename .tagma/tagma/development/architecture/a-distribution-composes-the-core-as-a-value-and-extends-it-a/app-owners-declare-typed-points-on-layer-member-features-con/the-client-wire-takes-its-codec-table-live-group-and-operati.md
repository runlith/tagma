---
id: 01a193d9-9a1f-79e8-9f71-7a9ff0c456d5
title: The client wire takes its codec table, live group and operation types from the descriptor's catalog
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a19371-d439-78c0-9c60-473fd4b30c0c
  - kind: waits-on
    to: 01a193d9-9a1f-79e8-9f71-7a97bd02efd7
---
Item 9 of [[d4b30c0c]]: a browser-safe `CATALOG_MODULES` replaces the `USED` list in `lib/wire/liveGroup.ts`, and operation types widen through an augmentable `interface Operations`.