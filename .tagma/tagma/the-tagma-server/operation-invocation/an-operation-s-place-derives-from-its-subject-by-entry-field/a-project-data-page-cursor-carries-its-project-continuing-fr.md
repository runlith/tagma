---
id: 01a156ea-c610-782c-8954-90b39314237c
title: "A project-data page cursor carries its project: continuing from another place refuses instead of answering with foreign data"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1565c-47b9-7ff2-bfd3-246b13adade8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15666-29d3-7512-8c0c-71e28fa6e159
  - kind: waits-on
    to: 01a156ea-c610-782c-8954-90b16bb9bbf2
---
`read_inspections` builds the page's question with `selection: {}`, so page B's cursor, handed to a call in A, answers with A's data. Find such project-data pages and put the project into their question; `GAUGES_WALK` cursors, which already carry a place, take `cursor` as their subject.

Proof: a system test — page B's `read_inspections` cursor in a call from A refuses `cursor-stale`; continuing `read_gauges` with one cursor answers from B.
