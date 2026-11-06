---
id: 01a1a893-53a7-73ab-a1d6-7673ce334c04
title: Descriptor admission includes transient native resources alongside retained transports
ord: 12
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a128f3-2660-7b02-bb52-7f08834c93bc
sources:
  - kind: file
    ref: packages/execution-host/native/holder/src/linux/mod.rs
  - kind: file
    ref: packages/execution-host/native/holder/src/linux/spawner.rs
  - kind: file
    ref: packages/execution-host/native/holder/src/macos/mod.rs
  - kind: file
    ref: packages/execution-host/native/holder/src/posix/backend.rs
  - kind: file
    ref: packages/execution-host/native/holder/src/posix/spawn.rs
  - kind: file
    ref: packages/execution-host/native/src/linux/terminal.rs
---
A launch can exhaust the descriptor table before its retained transport fits if admission omits confirmation pipes or enumeration descriptors that coexist with it. The selected holder backend therefore reports its real launch peak. Terminal control has a separate native-reported peak: a Linux flush temporarily opens the slave, so its slot must be funded alongside the logic's retained master. Keeping these costs with their native producer prevents a capacity promise from depending on spare descriptors that were never reserved.