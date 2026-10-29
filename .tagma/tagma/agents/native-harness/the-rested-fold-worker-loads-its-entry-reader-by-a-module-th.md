---
id: 01a188cf-6692-76fa-ac44-c366e5e5c094
title: The rested fold worker loads its entry reader by a module the inspection can resolve
ord: 62
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1889a-6037-78a2-8d09-8777b74bd780",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a188b7-9e8a-7d0d-bd44-2c1207ffe778
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/rested.worker.ts
---
The rested fold worker (`native-harness/transcript/rested.worker.ts`) loads the thread entry reader it decodes with by `import(source)`, `source` being the module the main thread's reader names (`ThreadEntryReader.source`: `composition/entryKinds.ts` for the composed reader, the agent kit itself for a core-only reader). The platforms inspection of rule 50520d64 cannot resolve that non-literal load, and its `loaders` declaration admits only code installed outside the tree, so the load stands as debt.

What was seen: the load target is in the tree and the server start already reaches it literally (`composition/manifest.ts` imports `composition/entryKinds.ts`), so the code it loads is judged on the server's platform; what is unproven is only the edge from the worker start.

View of the one who met the gate: two ways remove it.

- The inspection accepts a declared in-tree loader: a file whose non-literal load picks among modules a declared start already reaches. This keeps one fact — the reader the main thread decodes with is the reader the worker rebuilds — and changes the rule's inspection, which is the operator's word.
- Composition owns the worker entry (literal imports of a native-harness fold server and of `composition/entryKinds.ts`) and native-harness receives its URL through a port it declares. Every test reaching the rested worker (about twenty `composition/testing` files) must then bind the port, and a test reader that differs from the composed one can no longer reach the worker.
