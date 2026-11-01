---
id: 01a194fe-7ece-7d03-9df0-201eaeb9bbb6
title: A creation step whose entry is absent could still be decoded, to apply a default or refuse a missing value
ord: 265
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a19371-d3c3-70d3-886f-04320ac072c1
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/service/creation.ts
---
A step runs only when its id is in `contributed`, so a creation that sends nothing — an agent's `add_project`, the folder-pick path — never passes through it. Decoding every step, its schema taking absence, would let a step set a default or refuse a project born without its value; the price is that every creation path then depends on every installed step's schema.