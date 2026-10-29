---
id: 01a116c5-c485-7ca5-abbc-f27851c66cb6
title: "One fact has one owner: consumers read its answer or projection; deriving the same fact twice is forbidden, even for speed"
ord: 13
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
edges:
  - kind: discovered-from
    to: 01a1166f-7113-7752-b6b9-0a71c16f87cd
sources:
  - kind: dir
    ref: .
---
A fact is an answer to a domain question. The owner gives a counter, slice or single-path answer as a projection of the same revision. Speedup is the owner's incrementality or cache; a consumer doesn't repeat the computation.
