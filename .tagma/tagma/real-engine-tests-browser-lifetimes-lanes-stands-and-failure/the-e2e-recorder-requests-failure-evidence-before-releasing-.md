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
Keeping the fixture scope outside the body fiber leaves the browser available when the body fails or is interrupted. The recorder, rather than Bun’s native test timer, owns the shared hang bound because a native timeout can kill browser children before screenshots and traces are saved. Capture failures remain part of the failed outcome.