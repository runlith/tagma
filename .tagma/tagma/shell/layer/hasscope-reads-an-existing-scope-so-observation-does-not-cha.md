---
id: 01a13d6c-65bc-725b-84c1-11db8a6aa87d
title: hasScope reads an existing scope so observation does not change its lifetime
ord: 35
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/layer/src/App.ts
    symbol: MountedApp.hasScope
---
Warmth measurement and scope-retention decisions must see the state before the act: `ensure` and `scopeOf` can open a scope and turn a cold place warm by the reading itself. `MountedApp.hasScope` reads only an already open place; for a child tier the parent `Scope` is passed explicitly, otherwise the app counts as the parent. It does not read sources, build services or print a diagnostic report.
