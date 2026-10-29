---
id: 01a16c60-39cd-7bc9-a422-423868a1f8ac
title: "Product git in tests: 78 thousand processes and ~940 s CPU on the server's resource layers — find the top calling producers and cut at them"
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16c60-ca29-7e6f-8b62-6b2bf867736d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16c5d-ff92-708b-9d5d-fed108f81bea
---
Per the "after" measurement [[08f81bea]]: server itest — 24,734 git processes, 305 s; server stest — 53,709, 634 s. That is the largest named article inside body, which takes 69% of itest and 60% of stest. Every removed call cheapens the user's server too.
