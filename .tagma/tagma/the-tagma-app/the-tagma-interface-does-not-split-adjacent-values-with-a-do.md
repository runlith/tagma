---
id: 01a164eb-20d9-707f-89f8-fbbac6e02f23
title: "The Tagma interface does not split adjacent values with a \"·\" dot: meaning tells them apart — shade, weight or indent"
ord: 59
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
edges:
  - kind: relates
    to: 01a108a9-89cf-7f17-9b45-3b4c55b5437b
sources:
  - kind: dir
    ref: apps/tagma/app/src
  - kind: dir
    ref: packages/chat-ui/src
  - kind: dir
    ref: packages/primitives/src
---
Example: in the model switcher reasoning stands after the model name in a dimmed color and indented, with no dot between them. Dots already standing elsewhere in the interface are not removed along the way.
