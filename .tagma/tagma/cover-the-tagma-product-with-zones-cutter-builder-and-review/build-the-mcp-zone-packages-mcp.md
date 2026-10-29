---
id: 01a0ca52-661f-7f34-84ee-ece28a4cb223
title: Build the MCP zone (packages/mcp)
ord: 148
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Write the module, its areas and its claims for packages/mcp in one builder pass — no cutter runs for this package.

Read: every file whole under packages/mcp/src (about 2,100 tracked non-test lines), the package manifest packages/mcp/package.json with its four declared exports (`.`, `./server`, `./declaration`, `./identity`), and the boundary law it is measured by. Tests are leads only, never evidence.

Parent: the new module hangs directly under the project root. Reference zone: [[d1caad35]] (the agent kernel), read at depth 2 before writing, as the precision bar for titles, bodies and sources.

Depends-on edges may point only at modules that exist: utils [[382fa6aa]], layer [[59cc3c49]], executions [[6c81c6f3]], llm [[249ce587]], files [[b77b7a93]], trace [[bbed8039]], package-boundary [[0a611460]], testing [[acc2829b]], agent kernel [[d1caad35]]. Both packages depend on the agent kernel; an edge to the server or the app, which have no module yet, is named as waiting in the report, never drawn to a guess. A workspace package reached from tests alone is a devDependency and no edge.

Completion is proved by: module with dir source plus areas each one concern plus boundary and invariant claims written from the code; every claim verified after reading its sources with resolving symbol anchors; containers qualified where an act beneath differs with the exception its own claim; review with no FALSE/OVERBROAD/UNSUPPORTED unresolved and every omission written or declined with a reason; doctor clean over packages/mcp including owner-spread.