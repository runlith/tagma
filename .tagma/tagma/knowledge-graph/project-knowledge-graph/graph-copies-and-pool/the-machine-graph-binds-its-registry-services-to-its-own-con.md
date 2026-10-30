---
id: 01a145f2-c8f8-71e3-949c-46650a8e61b0
title: "The machine graph binds its registry services to its own context: a foreign-checkout registration lands on the machine graph's floor"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/routing.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/machine.ts
    symbol: machineGraphOf
---
`machineGraphOf` assembles the machine-graph context: it sets its floor (`machineRetirementGate`) and binds the registry services — `ProjectLifecycle`, `ProjectPolicy` and `GroupLifecycle` — to this context; a served copy's context and a call moved into another graph drop all three (`withoutRegistry`), so the machine's bound ones answer there. Each of their effects runs inside the machine graph, while who called it (session signature, aim) stays with the call.

This is needed because a call from a served project's checkout stands in that place's context. `placeContext` takes the mirror context, but the registry services in it are the machine's. Without the binding, a machine-graph act would read the call context's `TreeGuard` from the mirror. It would then settle a foreign tree under the machine-database writer and project its records into a foreign tree.

The same services stand in the call context and in the machine graph, so the "registry at the call place is the machine's" check compares them as is. The machine-graph context is assembled only through `machineGraphOf`, in product and in tests.
