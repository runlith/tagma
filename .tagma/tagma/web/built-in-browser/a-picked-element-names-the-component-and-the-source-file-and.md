---
id: 01a184e9-aef3-7244-b980-3e42f4fd662b
title: A picked element names the component and the source file and line that rendered it on a dev build
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18433-d315-73f4-812d-a71e5c06e846",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046a6700af16
---
The operator accepted (2026-10-29). A pick today carries selector, attributes, styles, HTML and a ref, so an agent asked to change "this button" on its own dev server still searches the code for the component. Dev builds of React, Svelte and Vue keep component metadata on rendered nodes (each in its own form and version), and T3 Code and Paradev already hand component and file to their agents. The pick reads that metadata when present and adds the component name and the source file with line, resolved to a path inside the project's checkout when it lies there; on production builds and ordinary sites the pick is unchanged. Reading must not turn on `Runtime.enable` or leave anything the page can see. Feature 6700af16 and the picked document change with it.