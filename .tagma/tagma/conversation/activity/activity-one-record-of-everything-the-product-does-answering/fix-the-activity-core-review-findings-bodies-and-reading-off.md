---
id: 01a11269-a3ce-7ee4-b5ba-178403b34468
title: "Fix the activity core review findings: bodies and reading off the main flow, ceilings, losses into coverage, read ownership"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a111d3-d45b-7adf-8e1a-f4a85ab9b442",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a111c0-a6a5-7a73-8f4d-f9f23b1981ef
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
---
Review of commits b421e6e33f, 136ff85faa, 96ba305119: architecture — `scratch/01a1124e-9ccc-7a35-9c75-61f5e2213752/activity-arch-review.md` (6 major, 15 minor; scores 6.5–9), performance — `scratch/01a1124e-9ccc-7a35-9c75-61f66d96aca2/activity-perf-review.md` (2 blocking, 7 major, 6 minor). Fix every finding the code confirms; a rejected one — named with proof. Done when the typecheck and affected tests are green, the acceptance measurement measures a real day-window query, and a repeat review scores at least 9 on every axis.
