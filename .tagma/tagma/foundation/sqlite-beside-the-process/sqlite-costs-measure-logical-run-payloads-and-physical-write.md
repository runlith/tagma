---
id: 01a18f1e-96df-7a12-b0af-0549d1e30cb6
title: SQLite costs measure logical Run payloads and physical writer leases independently of sampling
ord: 18
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/writerPermit.ts
---
Cost attribution follows the cause present when a Run is sent, including a failed SQL answer; admission rejection and an unsent Run add nothing. Request bytes cover SQL text and bound values; response bytes cover row values and object column names, or the values of an error's declared fields. Text and keys use UTF-8 length, blobs their byte length, numbers and bigints eight bytes, booleans and null one byte, and absent values zero; arrays sum their elements, objects their own keys and values. This is logical payload size, not structured-clone encoding: framing, identifiers, timing metadata and non-Run traffic are excluded. Writer wait uses physical monotonic time through grant, refusal or interruption; hold follows one physical lease through its existing release, including transaction controls and synchronous-level restoration. Nested transactions reuse that lease. A null cause skips accounting, and span sampling never controls these counters.