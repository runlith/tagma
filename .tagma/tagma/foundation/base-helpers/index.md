---
id: 01a0c702-bcab-7b1f-9440-825f382fa6aa
title: Base helpers
ord: 3
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/async.ts"
      },
      {
        "at": "src/class.ts"
      },
      {
        "at": "src/codeLanguage.ts"
      },
      {
        "at": "src/collection.ts"
      },
      {
        "at": "src/concurrency.ts"
      },
      {
        "at": "src/error.ts"
      },
      {
        "at": "src/event.ts"
      },
      {
        "at": "src/json.ts"
      },
      {
        "at": "src/LeaseRuntime.ts"
      },
      {
        "at": "src/lineAlign.ts"
      },
      {
        "at": "src/number.ts"
      },
      {
        "at": "src/object.ts"
      },
      {
        "at": "src/patch.ts"
      },
      {
        "at": "src/process.ts"
      },
      {
        "at": "src/random.ts"
      },
      {
        "at": "src/sequenceDiff.ts"
      },
      {
        "at": "src/sha256.ts"
      },
      {
        "at": "src/sha256.node.ts"
      },
      {
        "at": "src/stream.ts"
      },
      {
        "at": "src/text.ts"
      },
      {
        "at": "src/utf8.ts"
      },
      {
        "at": "src/uuid.ts"
      },
      {
        "at": "src/worker.ts"
      },
      {
        "at": "src/codec.ts"
      },
      {
        "at": "src/printed.ts"
      }
    ],
    "id": "@runlith/utils",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/utils
---
Runlith products take from here the primitives not worth writing twice: reading a value that arrived from outside, diffing two texts into a patch, parsing JSON that has not fully arrived yet, bounding in-flight work and finishing it, reporting a failure, and small decisions on names, numbers, and collections. The package owns the mechanisms themselves and nothing of the products that call them: which repo, which provider, and which surface is the caller's decision. The package boundary is its manifest: every module is reachable through a separate entry, dependencies are vendor-only, and no module does anything on import.
