---
id: 01a108a0-1765-74f2-b42a-3d583a5e55a9
title: "Commit-time visual-standard check: law-check in checks/law and a rule at gate"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a108a0-ed1d-7f8b-8537-c6adf5a9b8dc",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10891-853e-7f52-89f5-9e2869cfbc5c
---
Write a new check in the `checks/law` program (runner `runlith-law`) per the “How it is built” section in [[69cfbc5c]]: families, allowed names, arbitrary-value ban, exception files for color literals with “why”.

Code is written at once. Enabling via `enforce_rule` — after [[0325278f]] lands and the check shows zero violations.

Done when the rule in the graph is enabled at gate with zero debt and an intentional violation refuses the commit.
