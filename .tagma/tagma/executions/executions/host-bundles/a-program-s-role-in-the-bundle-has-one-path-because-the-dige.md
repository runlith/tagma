---
id: 01a1288d-3b7d-700d-b90c-2ad8806ec229
title: A program's role in the bundle has one path because the digest never depends on part order
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/executions/src/hostArtifacts.ts
  - kind: file
    ref: packages/executions/src/protocol/artifact.ts
---
Digest independence from part order lets the packer walk the directory in any order. Two same-role programs would make order a hidden launch choice with no digest change; so launch programs carry unambiguous roles, and migrations belong to a separate metadata role.
