---
id: 01a18513-f697-7c89-b6e0-917c750aaed4
title: Picking inside an out-of-process frame enters inspect mode in that frame
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18433-d315-73f4-812d-a71e5c06e846",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a184e9-aef3-7244-b980-3e42f4fd662b
---
The component-source regression scenario exposed a separate picking defect: an outer page on 127.0.0.1 with a localhost iframe accepts a click on the child's public snapshot ref, but the browser.pick feed emits no picked element. The same scenario with two 127.0.0.1 ports passes. Automation.pick enables Overlay and inspect mode only on the root session; adoptChild enables no Overlay. Enable, restore and end inspect mode for child sessions consistently with cursor capture, including frames attached while picking. Prove it through the managed browser's public pick feed without a test-only event injection.