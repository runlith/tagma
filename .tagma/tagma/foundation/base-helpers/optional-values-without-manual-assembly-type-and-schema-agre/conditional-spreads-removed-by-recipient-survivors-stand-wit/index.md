---
id: 01a127f0-b30d-775b-8018-44399dde029d
title: Conditional spreads removed by recipient; survivors stand with permission and reason
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127f0-4ce7-7edb-adb0-9eb640ffd688
  - kind: waits-on
    to: 01a127f0-b2c2-7874-a236-cb257814300f
---
Remove conditional spreads following the spec's step-4 procedure: read the object's recipient and either pass the value directly, move default overlay into `??` at the owner, or keep the spread with a permission and reason. `pickDefined` and `pickPresent` leave with the last call.

Runs in batches by module, each batch a separate delivery with green typecheck and tests for its packages. Mechanical work: Sol medium/high or Muse.

Done when every remaining site stands with a permission and reason.
