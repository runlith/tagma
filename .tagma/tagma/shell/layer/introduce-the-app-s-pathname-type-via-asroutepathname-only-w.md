---
id: 01a0c710-46e0-7f34-b12c-500a84e34b38
title: "Introduce the app's pathname type via asRoutePathname only where your own boundary produced the value: the cast checks nothing"
ord: 28
tags: ["rule"]
sources:
  - kind: file
    ref: packages/layer/src/Router.ts
  - kind: symbol
    ref: packages/layer/src/Router.ts
    symbol: asRoutePathname
  - kind: symbol
    ref: packages/layer/src/Router.ts
    symbol: RoutePathname
---
Live location, history and storage values stay strings; asRoutePathname checks nothing.
