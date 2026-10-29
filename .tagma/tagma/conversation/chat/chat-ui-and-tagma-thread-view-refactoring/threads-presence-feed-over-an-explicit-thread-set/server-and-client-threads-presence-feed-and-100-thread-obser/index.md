---
id: 01a11901-470f-7498-99ae-69f003fb96bb
title: "Server and client: threads.presence feed and 100-thread observer scenario"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e833589ccf
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-9122d46485b4
---
Per [[33589ccf]] in full; waits for `RunStatus` ([[9f3bb3f9]]) and entry deltas ([[c3436715]]).

Done: feed tests; 100-thread observer scenario within budget.
