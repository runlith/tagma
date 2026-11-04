---
id: 01a1a809-1932-7465-ace6-6eae3277cc67
title: Native execution platform · kit
ord: 53
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "lib.rs",
        "role": "port"
      },
      {
        "at": "linux/procfs.rs",
        "for": [
          "4a736f36"
        ]
      }
    ],
    "id": "execution-platform",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/execution-host/native/src
---
The host needs kernel process witnesses, accounting and descriptor I/O without coupling its logic to an operating system. This Rust library owns the native ABI and its platform backends; the holder also uses its Linux process reader, while composition chooses the build and the TypeScript adapter interprets the ABI.