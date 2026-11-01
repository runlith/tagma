---
id: 01a19517-e56d-7c93-9069-0242019cd192
title: Module cards of another repository import this project's modules, so one import check spans the core and a distribution
ord: 34
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a19371-bc70-7ecd-b2c5-96b9f492b72c
---
A distribution's code imports the core through `@tagma/server` and `@tagma/app` exports, which the core's module cards declare as entries. Its own modules live in another repository's graph, so today no import check judges a distribution module against the core's cards: it can import any exported path. Would a cross-project `imports` relation on a module card be worth it, and does the import check read another project's cards? Raised by the seams spec [[f492b72c]].