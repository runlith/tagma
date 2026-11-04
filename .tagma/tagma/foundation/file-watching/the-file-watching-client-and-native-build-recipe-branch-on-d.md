---
id: 01a1a76d-6043-7fca-b1bc-101e832e98ac
title: The file-watching client and native build recipe branch on darwin in TypeScript
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: packages/watch/src/client.ts
  - kind: file
    ref: packages/watch/src/artifact.ts
---
The engine has one Rust backend per OS (`native/src/macos.rs`, `native/src/linux.rs`), which are the adapters. The TypeScript above them still decides by OS: the client chooses how a position is marked, and the build recipe names the macOS library, triples and linker flag.

Read at ee24295b8e:
- `packages/watch/src/client.ts:399` `marking` is `refresh` on darwin and `close` elsewhere, because FSEvents and inotify differ in what a cursor proves.
- `packages/watch/src/artifact.ts:15-17` library file by OS; `:25` Apple triples only; `:38` macOS `-install_name` link arg; `:54` recipe hash by `process.platform`.

Done when the engine reports what its cursor guarantees as part of the contract so the client does not ask the OS, the build recipe is per-OS data supplied beside each native backend, and the kit's tests pass on a Linux runner.