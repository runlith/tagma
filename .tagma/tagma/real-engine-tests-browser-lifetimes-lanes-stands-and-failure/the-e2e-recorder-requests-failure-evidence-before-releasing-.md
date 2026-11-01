---
id: 01a19963-d6a1-7ab9-8064-62050d667f3f
title: The e2e recorder requests failure evidence before releasing its fixture scope
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/artifacts.ts
  - kind: file
    ref: packages/e2e/src/browser.ts
  - kind: file
    ref: packages/e2e/src/lanes/ios.ts
---
Keeping the fixture scope outside the body fiber lets the recorder request evidence before that scope’s cleanup runs when the body fails or is interrupted. The recorder owns the shared hang bound; native registration uses `Infinity` because Bun 1.4.4 can fire an earlier hook’s timer during a later test, and zero makes its process-killer treat that test as expired before evidence is saved. Capture failures remain part of the failed outcome.