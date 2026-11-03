---
id: 01a13622-84ad-7579-8ca7-e93f0b74de4d
title: "\"Release JS is minified fully without keepNames: only diagnostic texts read a class or function name in release bundles\""
ord: 7
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
sources:
  - kind: file
    ref: apps/tagma/app/vite.config.ts
  - kind: file
    ref: apps/tagma/desktop/scripts/build-host.ts
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
  - kind: file
    ref: packages/bundle/src/bundle.ts
  - kind: file
    ref: packages/execution-host/src/buildArtifact.ts
---
The release build minifies whitespace, syntax and names in Bun.build (the CLI, the server with workers, the executions host and recovery) and in the desktop esbuild; the client surface is minified by Vite by default. `keepNames` is on nowhere: in Bun and esbuild it is a whole-build option, and its cost is source names as strings in every bundle.

The decision rests on reading unminified release bundles (the `release` condition, 2026-10-13) for `constructor.name`, `ctor.name`, `new.target.name`, `fn.name`, `Function.prototype.toString` and function source parsing. Only diagnostic texts read a class or function name:
- Effect `Formatter` — printing class instances (`Name({...})`);
- zod — issue texts (`received <class>`, `instanceof`);
- `@anthropic-ai/claude-agent-sdk` — error texts;
- `@runlith/utils` `errorChain` — the `tag` in the `server-fault` answer's `causes` for a thrown object that is not an `Error` and carries no `_tag`.

asn1.js (through web-push) compares `constructor.name` against `DecoderBuffer`/`EncoderBuffer` only after `instanceof`, which fires first when the bundle holds a single copy of the package. Effect error names come from `_tag`, service keys are explicit strings.

Without `keepNames` these texts show minified names; no behavior depends on them. Code whose behavior depends on a name (key, dispatch, wire, stored data) switches `keepNames` on in the build whose bundle carries it, and the release trial run verifies it. The trial run executes the CLI, the server and the execution host; the desktop and surface are not executed by it.
