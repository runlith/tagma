---
id: 01a111c0-a6a5-7a73-8f4d-f9f23b1981ef
title: The @runlith/activity package, activity.sqlite store, combinator, and model-call in ModelRequests; move all producers and readers over, delete trace and trace-bundle
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a111d3-d45b-7adf-8e1a-f4a85ab9b442",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
  - kind: waits-on
    to: 01a111c0-a6a5-7a73-8f4d-f9f02a1c3703
  - kind: waits-on
    to: 01a111c0-a6a5-7a73-8f4d-f9f1bfec14bd
---
Step 2 of the spec in one change: the "Model", "Storage", "Reading", "Ownership" sections. Done per the spec's acceptance (combinator unit, store integration with TestClock, main-flow measurement, O(1) fact recording).
