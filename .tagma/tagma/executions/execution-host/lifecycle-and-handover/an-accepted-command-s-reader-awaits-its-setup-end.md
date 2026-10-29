---
id: 01a129a7-9891-75b7-924c-ead1b5c77188
title: An accepted command's reader awaits its setup end
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12997-a9d1-7c31-a95b-c5dd42b2b5b0
sources:
  - kind: symbol
    ref: packages/execution-host/src/registry/reads.ts
    symbol: readerReady
---
An accepted command already belongs to the host, although its record and child are still assembling. Reader opening awaits registry events while the command stands in the accepted queue; a departure with no child ends the wait in refusal. Otherwise an immediate subscription after Accepted loses all of stdout, declaring a known execution unknown.
