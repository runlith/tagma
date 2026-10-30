---
id: 01a0c719-0966-7771-b843-5c4b48d023be
title: Call HostRegistration.record only from the process that holds the writer claim on the state directory
ord: 1
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/HostRegistration.ts
  - kind: symbol
    ref: packages/executions/src/HostRegistration.ts
    symbol: record
---
`record` reads the standing registration and rewrites it with no lock of its own.