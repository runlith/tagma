---
id: 01a12aea-7ab3-71a9-8304-a866aa222faf
title: A native-launch refusal swaps the reserved receipt in one transaction
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12ada-1b67-7827-8b44-072d3f4692be
sources:
  - kind: file
    ref: packages/execution-host/src/registry/launch.ts
  - kind: symbol
    ref: packages/execution-host/src/holder-client/Connection.ts
    symbol: connect
  - kind: symbol
    ref: packages/execution-host/src/nativeLaunch.ts
    symbol: launchNative
  - kind: symbol
    ref: packages/execution-host/src/registry/adoption.ts
    symbol: adoptHeld
  - kind: symbol
    ref: packages/execution-host/src/store/ExecutionStore.ts
    symbol: ExecutionStore
---
Reservation takes the key before the native launch, so Accepted never proves a child was born. A confirmed refusal or rollback writes Refused with the execution end; a lost answer and an unconfirmed rollback write Uncertain, keeping the record alive with no seal. At boot, adoption resolves the outcome against the holder's full table: a present child gets Accepted and its state, an absent one Refused and ended; the table is complete because the holder starts the next logic only after starting finishes. Refusing to reap a present child keeps Uncertain and the untaken record for the next logic. Adoption restores the adopted live execution's cleanup obligation so a later writer death never reads as no held work. Ordinary settle keeps the first answer; the outcome transition belongs to separate store transactions. If writing the outcome fails, the caller gets Uncertain/StoreFailed.
