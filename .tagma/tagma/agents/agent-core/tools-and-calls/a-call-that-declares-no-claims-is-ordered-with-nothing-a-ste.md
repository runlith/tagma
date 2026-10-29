---
id: 01a15fc8-9b23-78fe-9b6e-3320ed5cc55e
title: "A call that declares no claims is ordered with nothing: a step's order rests only on declared resources"
ord: 12
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15113-e4c9-763e-bcc6-16a807c34834
sources:
  - kind: symbol
    ref: packages/agent/src/agent/tool.ts
    symbol: toolClaims
---
A call that declares no claims is ordered with nothing: a step's order rests only on declared resources.

One step's calls run in the order the model called them — in parallel. `CallOrder` queues a call only behind calls whose declared claims intersect its own. A tool or operation with no `claims` gets the empty set: it waits for nobody and delays nobody, whether it mutates or not, and whatever `effect` the operation declares.

The operator decided this on 2026-10-21, cancelling the earlier default from [[07c34834]]: then an undeclared mutating call became a `write(all)` barrier and a non-mutating one a `read(all)` barrier. The barrier serialized independent work: ten `generate_image` calls of one step ran one after another at ~14.5 s each because the operation declared `effect: 'external'` with no claims. Races between undeclared calls are now allowed: order belongs where the tool owner knows what intersects, and declares it.

The barrier stays only where declared: `everyClaim('write')` on `bash` with an unparsed command part and on `delete`. MCP annotations for terminal CLIs (`operationWrites`) still derive from `mutates` of undeclared operations; that order is owned by the vendor.
