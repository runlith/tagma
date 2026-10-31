---
id: 01a193f9-709a-7ec4-9ffd-404ff1404d25
title: A fallback yields only to a provider admitted with it or before it; a replacement admitted later refuses
ord: 46
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/layer/src/Layer.ts
    symbol: Layer.fallback
  - kind: file
    ref: packages/layer/src/Graph.ts
---
A port's readers take its instance once, when they are built, and the graph keeps no reverse dependency to rebuild them. If a replacement could arrive after the fallback stands — when a `Layer.when` condition turns on, a chunk lands or an entry is entered — readers built before would keep the fallback while later ones got the replacement: two implementations of one service at once, and a dropped condition would hand back a fallback nobody built for those readers. So the order is fixed by admission: a provider listed in the manifest itself, or in the same condition or chunk as the fallback, replaces it whatever their order; a fallback admitted where a provider already stands yields silently; a provider admitted after its fallback stands refuses `DuplicateProviderError` with that reason, and so do two fallbacks of one key. A distribution therefore replaces a port at the top of its manifest, or with `Layer.load` for a deferred key, whose chunk definition is itself a manifest entry.

The world fillers `App.load` and `App.handle` hand in (`Platform`, `Router`) still yield to any manifest entry of their key, a fallback included.