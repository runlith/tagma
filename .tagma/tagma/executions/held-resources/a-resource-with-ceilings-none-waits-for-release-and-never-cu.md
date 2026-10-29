---
id: 01a17a6d-d94c-74b1-9479-c091b9fe4a4e
title: "A resource with `ceilings: 'none'` waits for release and never cuts its holder: holding with no deadline verdict"
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/held/src/Held.ts
    symbol: UncutDeclaration
---
A wait ceiling passes a deadline verdict: the waiter leaves with `HoldStalled` and never learns what became of the resource, while a cut holder (`HoldCut`) is interrupted mid-work. For a resource whose holder is work of the same process that finishes on its own (an agent tool's file write), that is an answer with no outcome where an outcome is coming. A resource declared with `ceilings: 'none'` waits for the fact ([[7609a86c|waiting on the fact]]): only a release lets the waiter in, and only its own interruption removes it; the holder holds until its work ends and is never cut. `threshold` still writes a long-hold record with `HeldFor`, so a stuck holder is visible, not silent.

The type answers the same: such a resource is `Held<K, never>`; its holdings add neither `HoldStalled` nor `HoldCut` to the caller's errors, and there is nothing to catch. For a resource whose holder waits on a foreign process or the network, the ceiling stays: there a deadline is the only way to learn no answer is coming.
