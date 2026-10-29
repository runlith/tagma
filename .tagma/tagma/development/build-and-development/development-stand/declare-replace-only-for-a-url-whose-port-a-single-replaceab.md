---
id: 01a0c83c-e1d9-7950-b41b-a262364d4495
title: Declare `replace` only for a URL whose port a single replaceable process listens on
ord: 7
tags: ["rule"]
sources:
  - kind: file
    ref: packages/dev-runner/src/index.ts
  - kind: symbol
    ref: packages/dev-runner/src/index.ts
    symbol: listenerPids
  - kind: symbol
    ref: packages/dev-runner/src/index.ts
    symbol: replaceRunning
---
