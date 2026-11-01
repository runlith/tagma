---
id: 01a1948f-fbbf-726a-8887-ab4bdfa17642
title: Replaceable server ports take a core default filler, so no call site checks for absence
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193ea-34cd-7827-8f66-267225b84179",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a19371-d3c3-70d3-886f-04320ac072c1
---
Item 6 of [[0ac072c1]]. Where the core must work alone, the owner provides the default and another root overrides it; the two `Bindings` slots of the build descriptor have no core default today.