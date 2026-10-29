---
id: 01a156e8-00ec-7b24-8395-b0fe44117b6c
title: "Prototype the spec's assumptions: config execution isolation in Bun, SDK types from Effect schemas in dist, inspection programs run by Tagma's Bun"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a156c5-bb98-7bca-8680-5002e174fd5d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a156d9-a73e-7045-bbfd-b087b6f7a4e0
---
The spec stands on three assumptions nobody has prototyped. Check them with a prototype in scratch, not in product code, and fix the spec where something fails:
- the Bun loader executing `tagma.config.ts` serves files only from the judged version, serves `@runlith/tagma/*` from Tagma's copy, and cuts builtin modules, other packages, network, environment, fs, spawn, clocks and randomness;
- `/rules` types derived from the `@tagma/inspection` Effect schemas build into `dist` with no references to `effect` or `@tagma/*`;
- Tagma runs an inspection program with its own Bun through its own runner: the module from the checkout takes dependencies from the project's `node_modules`, and receives `@runlith/tagma/*` from Tagma's copy.

Proof is the prototype's scenarios and their output in the task's finish.

## Outcome (Bun 1.4.3, macOS arm64, one sample; prototype in the rules-surface-spec thread's scratch, not in the repository)

- **Runtime interception does not work.** A `Bun.plugin` with `onResolve` cannot see builtin modules: a config read `/etc/hosts` through `node:fs`, `fs`, `require('fs')`, `import.meta.require`, and loaded `bun:sqlite`. It also failed to resolve a bare `@runlith/tagma/rules` from a module in the virtual namespace.
- **Build plus `node:vm` holds the boundary.** `Bun.build` (IIFE) with a build plugin serving the version's files from memory refuses `node:fs`, `fs`, `require('fs')`, `bun:sqlite`, `typescript`, and value imports of files pulling `typescript`; `import type` passes. In `runInNewContext` there is no `Bun`, `process`, `require`, `crypto`, `performance`: `Function(...)`, `(0, eval)(...)` and `globalThis.constructor.constructor(...)` see `undefined` there. `Date.now`, `new Date()` with no arguments and `Math.random` are replaced and refuse, `new Date(0)` works. Top-level await is impossible in IIFE — that is the config's limit. The law-lab example built and yielded `{ builtin: 'loads', params }`; loaded paths and resolver misses recorded.
- **Types from schemas.** The TypeScript checker's `typeToString` unwrapped the `Encoded` of the `loads`, `modules`, `size`, `swallowed-failures` and `names` schemas into object types (7.2K characters) with no references to `effect`, `Schema` or `@tagma/*`. `withDecodingDefaultKey` gives an optional key in `Encoded`. The checker does not carry field descriptions: the build takes JSDoc from schema annotations.
- **Runner with its own Bun.** `~/.tagma-dev/install/current/bun` (1.4.3) with an empty environment ran the runner, which imported the program module from the project directory. The module took `typescript` 6.0.3 from the project's `node_modules`, and received `@runlith/tagma/rules` from the runner's copy through `build.module`; runtime `onResolve` did not intercept that bare specifier.

Specs [[b6f7a4e0]] and [[d9ef0c58]] were corrected to these results.
