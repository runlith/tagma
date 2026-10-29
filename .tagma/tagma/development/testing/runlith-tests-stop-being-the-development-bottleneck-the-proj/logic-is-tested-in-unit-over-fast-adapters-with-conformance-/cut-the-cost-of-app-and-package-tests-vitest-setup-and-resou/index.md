---
id: 01a16dee-c03f-7b5a-8fe3-ac9cde13d8d6
title: "Cut the cost of app and package tests: Vitest setup and resources outside the server"
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
  - kind: relates
    to: 01a16ac4-44bf-7e0a-8178-b705a099f1ad
---
Remove repeated Vitest setup and spare real resources in the app and package tests, except execution-host. Baseline run CPU: app unit 106.3 s, app integration 34.0 s, packages unit 113.5 s, packages integration 183.8 s, former packages system 138.1 s; part of execution-host handed to another performer. Per-file outcomes, measurements and covering checks are tracked in x10/x-packages.tsv.
