---
id: 01a193f9-54ef-72db-ab86-52dfa6c77ee7
title: A point contribution is an eager member key named `<point>:<from>`; a clash fails that member's start and the first holder stays
ord: 45
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/layer/src/Graph.ts
  - kind: file
    ref: packages/layer/src/Point.ts
---
`contribute` makes a member of its own for each call so the contribution lives exactly as long as the layer that carries it: under `Layer.when` it joins and leaves with the condition, in a chunk when the chunk lands, and at the point's tier it closes with the point's scope. It is eager because nothing resolves it — only its build joins the point, under lazy building too. A browser window resolves keys in its route loads before `App.mount` starts the app scope, and a start alone would wake no member then. So a `Layer.member` definition names its owner (`joins`), and when the owner is built in a scope that has not started, the graph builds the owner's standing members as soon as the outermost build returns. Waiting for that return keeps a member that needs a key still being built from failing as a cycle. A member whose early join failed is not tried again by that scope's start, so its clash is reported once. Its id is the point's id and `from`, so two `contribute` calls with one `from` on one point are two keys of one id and refuse `KeyIdCollisionError`, inside one condition or chunk too; give each contribution its own `from`.

A clash is found when the second member builds: it fails as `ServiceStartError` whose cause is `RegistryClash` naming both contributors, reported through `Failure` rather than thrown at assembly, and the point keeps the first holder's items. The list is published through the graph's `cell` hook: reactive in the browser, a plain value on the server, so a point reads the same under any backend the graph is given.