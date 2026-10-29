---
id: 01a16e70-4e20-7bd6-808a-cfbd22e94347
title: "Rule SDK signatures never count at every server-process load: the macro loads only when the read_inspections answer carries them"
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-1e3a-73ae-9e16-b62321fe10a1",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/reads.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/signatures.ts
---
In source mode (tests, dev) the Bun macro `ruleSignatures` runs when transpiling the module that imports it: it loads `typescript` in the macro context and emits SDK door declarations. While the macro stood in `enforcement/rules/reads.ts`, that cost ~1 s CPU per process that loads the enforcement operation bodies — i.e. every door-world and server build. The macro moves to `rules/signatures.ts`, and `reads.ts` loads it with `import()` only for the signature-carrying answer. In the release bundle the value is still inlined at build.
