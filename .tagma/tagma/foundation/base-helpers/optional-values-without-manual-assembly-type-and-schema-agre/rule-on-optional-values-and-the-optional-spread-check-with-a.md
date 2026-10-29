---
id: 01a127f0-b3ae-7dfb-815e-8e4da4dae1c6
title: Rule on optional values and the optional-spread check with a run to decide the gate
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
  - kind: waits-on
    to: 01a127f0-b368-7fbf-ae46-f6f97d07185e
sources:
  - kind: dir
    ref: checks/law/optional-spread
---
Step 5 of the spec: rule [[49532ac2]] already stands in the graph; the `optional-spread` inspection in `checks/law` (runner `runlith-law`) modeled on `swallowed-failures`, with per-site permissions in its parameters.

A non-blocking run over the whole code — after the first cleanup wave; its count decides whether to put the inspection on `gate` via `enforce_rule`, with the remainder as debt on the cleanup task, or to keep only the rule text.

Done when the inspection finds the spec's forms on the corpus and does not fire on a site with a permission, and the run report and the `gate` decision are recorded.
