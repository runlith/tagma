---
id: 01a0ea9b-7901-7f14-b806-e487e090f46d
title: "A lower module does not know the upper one: it declares a port or subscribes to an event in its own contract, and composition binds a filler"
ord: 5
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: .
---
When it needs a module above or outside its declared dependencies, the lower one neither imports it nor accepts its type or a callback typed by it. What it needs it declares in its own contract/service by subject; the upper one fills the port, composition binds them.
