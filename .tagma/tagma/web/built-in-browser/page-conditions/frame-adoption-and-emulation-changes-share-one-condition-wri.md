---
id: 01a18515-99ec-70ce-9bec-a080bca862bc
title: Frame adoption and emulation changes share one condition-write queue
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: symbol
    ref: apps/tagma/server/src/browser/engine/emulate.ts
    symbol: changeConditions
---
Frame adoption runs outside the page queue, so its pending CPU command can otherwise be followed by an obsolete network write after a newer emulation change. A separate condition-write queue orders adoption, changes and cleanup without blocking adoption behind a page operation that is itself waiting for the frame.