---
id: 01a0c6ed-5b45-77b0-a47b-9e0ab77b7a93
title: Files
ord: 19
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/change.ts"
      },
      {
        "at": "src/content.ts"
      },
      {
        "at": "src/hunk.ts"
      },
      {
        "at": "src/lines.ts"
      },
      {
        "at": "src/namespace.ts"
      },
      {
        "at": "src/replace.ts"
      },
      {
        "at": "src/resource.ts"
      },
      {
        "at": "src/witness.ts"
      },
      {
        "at": "src/working.ts"
      },
      {
        "at": "src/entries.ts"
      }
    ],
    "id": "@runlith/files",
    "kind": "kit"
  }
edges:
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/files
---
Runlith identifies filesystem objects by what they are, not by how the path is written: the root, repository, worktree, and terminal registries compare witnesses where paths would lie, and the address carries a namespace telling apart the same `/work/shared` across providers. The package owns the shared vocabulary of these owners — namespace and address records, witness-making from stat, and comparing two witnesses — as well as a single implementation of what both agents and the file manager need: text digest and row-window search, content recognition (text, binary, non-UTF-8), row-wise edits, file writing checked against the current content, the write fact, and the file-change hunk. Which namespace, whose read, and what the outcome means are the callers' call.
