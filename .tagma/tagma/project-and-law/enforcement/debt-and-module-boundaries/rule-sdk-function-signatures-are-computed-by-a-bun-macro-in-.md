---
id: 01a16e74-37ed-7a16-afed-6aef3544149f
title: Rule SDK function signatures are computed by a Bun macro in a separate module, loaded only for a read_inspections answer with a signature
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/signatures.ts
---
The `ruleSignatures` macro loads `typescript` and emits SDK door declarations. In a release bundle its value is inlined at build. In source mode (tests, dev) Bun runs the macro while transpiling the importing module, in every process, and that costs ~1 s CPU. Statically importing that module from a module loaded when the composition assembles (enforcement operation bodies) would charge every server and every door world. So `reads.ts` takes the module through `import()` only where the answer carries a signature. The bundle builds with no splitting as one file, so the dynamic import stays inside it.
