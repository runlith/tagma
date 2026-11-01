---
id: 01a194a8-ab66-70cc-914e-744047a2aaad
title: "A point defined with `joins: 'start'` refuses every member arriving after its scope's start has settled"
ord: 47
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/layer/src/Point.ts
  - kind: symbol
    ref: packages/layer/src/Graph.ts
    symbol: Graph.settled
---
The graph resolves `settled(scope)` once the scope's start has built its eager keys and the conditions and chunks that start admitted. After that, such a point refuses a member under a `Layer.when` that turns on later, a chunk that lands later, and `register`, through the point's admission (`RegistryRefusal` reported through `Failure`). A reader that judges stored references against the point and drops what it does not find, as a layout restore does, can then take the start set as final. A point that legitimately grows at run time, such as surfaces registered from app views, leaves `joins` unset.