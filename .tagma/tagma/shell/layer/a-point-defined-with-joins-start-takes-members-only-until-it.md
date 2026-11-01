---
id: 01a194a8-ab66-70cc-914e-744047a2aaad
title: "A point defined with `joins: 'start'` takes members only until its scope's synchronous start ends"
ord: 47
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/layer/src/Point.ts
  - kind: symbol
    ref: packages/layer/src/Graph.ts
    symbol: Graph.starting
---
The point admits a member only while `Graph.starting(scope)` holds, that is, before its tier's scope has started or during the synchronous part of its start. Members that join before the start are the manifest's own: they join when the point is first built in a route load, before `App.mount` starts the app. The check reads the graph at admission, so a point first built after the start refuses at once. A member that arrives later refuses through the point's admission (`RegistryRefusal`, reported through `Failure`): one under a `Layer.when` that turns on later, a chunk, even one whose condition holds at start, and `register`. A chunk counts as late because rung scopes and the window are already drawn while it loads. A reader that judges stored references against the point and drops what it does not find, as a layout restore does, can therefore take the items it reads as final. A point that legitimately grows at run time, such as surfaces registered from app views, leaves `joins` unset.