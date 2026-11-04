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
Native registration provisions each fresh clone, Safari and page inspection in a per-test setup hook, reporting its cost as tenant work. Setup, scenario and teardown use the same hang bound and share one artifact recording; the fixture scope outlives the phase fibers, so setup and body failures request the available native and page evidence before cleanup. Native callbacks use `Infinity` to leave the bound with the recorder because Bun 1.4.4 can fire an earlier hook’s timer during a later test, while zero makes its process-killer expire the test before evidence is saved. Capture failures remain part of the failed outcome.