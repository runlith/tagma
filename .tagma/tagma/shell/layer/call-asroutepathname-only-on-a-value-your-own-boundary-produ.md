---
id: 01a0c710-46e0-7f34-b12c-500a84e34b38
title: "Call `asRoutePathname` only on a value your own boundary produced: it is an unchecked cast"
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
Live location, history and storage values stay strings.