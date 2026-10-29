---
id: 01a174f2-3d47-7207-a202-bde690fa7bd9
title: Attention
ord: 38
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "."
      }
    ],
    "id": "app-attention",
    "kind": "product"
  }
edges:
  - kind: imports
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: imports
    to: 01a0fd8b-bedd-7f22-b461-adddedf810fe
  - kind: imports
    to: 01a0fd8b-bf06-7d52-a6ca-9e8e1a45453a
  - kind: imports
    to: 01a1234b-f246-7286-b7d6-ffd1913a0b97
  - kind: imports
    to: 01a174f2-3d3c-7aba-98fd-93f206137f5a
  - kind: imports
    to: 01a174f2-3d42-7971-98e6-d64d57643bc7
  - kind: imports
    to: 01a174f2-3d52-7cb0-8660-a40d39910e41
  - kind: imports
    to: 01a174f2-3d55-75b3-a0ce-6ad72dc811be
  - kind: imports
    to: 01a174f2-3d5a-7431-8610-6fcfbbff045a
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/app/attention
---
When an agent waits for the operator or something breaks, it lands in "Attention": a button with a count, notification cards, and a jump to the thread or place the notice is about. The server issues the notifications; the module shows them and leads to the place.
