---
id: 01a135f8-f7ec-73bb-8f3f-20a1953e374e
title: Full release JS minification, maps with the operator and tagma:stack for user stacks
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a135ff-078a-74bd-b92d-084ee560e7b0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13209-1c70-7d0c-87f4-40b2e7b7be7f
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/release.ts
---
Section "Public build" of the spec. Release Bun.build, Vite and esbuild minify whitespace, syntax and names; `keepNames` only where code reads a class or function `name` (found by reading, not guessing). Maps are written outside the archive to the operator's shelf by release number; `bun run tagma:stack <release>` translates a stack from stdin. The "no sources" check stays.

Done: minified release passes three checks and the trial run; a stack thrown by the release is printed by `tagma:stack` in source files and lines.
