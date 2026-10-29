---
id: 01a1615d-f133-795b-9168-a4a02c0a6483
title: Delete without -v reduces deletion outside a checkout to final counters
ord: 54
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1615d-9c1d-727e-9caf-2aee2ca75547",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16154-c78c-728f-b9fa-a554b3e61738
---
Remove the short delete answer's dependence on the record: without -v return a summary and keep the meaningful errors, even when the files lie outside a registered checkout. Check the tool's public contract with a minimal test.
