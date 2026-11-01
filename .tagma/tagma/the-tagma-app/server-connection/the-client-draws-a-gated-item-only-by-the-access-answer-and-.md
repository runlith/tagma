---
id: 01a194a8-e6d9-7496-babf-e99df53a68ef
title: The client draws a gated item only by the `Access` answer and never removes its declaration
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/access.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Door.ts
---
The server decides whether an act is allowed. The client reads the same answer only to draw: an item under a right shows its own payload when the answer is `read` or `full`, its `offer` when it is `none`, and nothing while the answer is unknown or no filler stands. A missing answer draws nothing, so a window never offers an act the server would refuse. The right never removes the item from its point or registry, because the answer can arrive after a layout restore or a registry index has read the declarations, and removing the item there would sweep saved tabs or references that the next answer admits. A refusal carrying a `right` gets its `AccessHint` note and act in `Door`, where every operator act's refusal is formed, so every surface showing that `Told` shows the hint without knowing about rights.