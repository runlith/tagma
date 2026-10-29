---
id: 01a156ee-85b8-7fb5-ad25-ad06987d0e6e
title: "Custom inspections and linters from the config: Tagma's runner for `defineProgram`, `Linters.command` and named linters, fingerprint by key; `runners.json` reading, `enforcement.programs` and `checker.ts` go away"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15755-d9fc-7148-bba5-ae537a1a1c94",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b087b6f7a4e0
  - kind: waits-on
    to: 01a156ee-85b8-7fb5-ad25-ad0590e3a1c9
---
The "Custom inspection" and "Linters" sections [[b6f7a4e0]]:
- a runner carried by the server that runs the `defineProgram` module with Tagma's Bun, serves `@runlith/tagma/*` through `build.module` (prototype [[44117b6c]]), and calls the function per key with both sides and `covered`;
- `Linters.command` with SARIF and `findings`, named linters from a tool description;
- fingerprint `<key> <fingerprint>`;
- delete `runners.json` reading, the `enforcement.programs` setting (code and database migration), and `programs/descriptors.ts`/`checker.ts` in their current form.

Proof: integration on a fixture — a program with two keys goes in one process and judges a change; `Linters.command` with SARIF output judges the same as a named adapter.
