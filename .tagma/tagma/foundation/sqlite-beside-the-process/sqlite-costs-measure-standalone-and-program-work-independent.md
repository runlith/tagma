---
id: 01a18f1e-96df-7a12-b0af-0549d1e30cb6
title: SQLite costs measure standalone and program work independently of sampling
ord: 18
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/writerPermit.ts
---
Standalone statement and payload attribution follows the cause present when a Run is sent, including a failed SQL answer; admission rejection and an unsent Run add no Run cost. Submitted programs separately count the statements and guards they carry, including any skipped after a conflict. Request bytes cover SQL text and bound values; response bytes cover row values and object column names, program outcomes, or an error's declared values. A shared failed batch charges its error payload once to its first member's cause. Text and keys use UTF-8 length, blobs their byte length, numbers and bigints eight bytes, booleans and null one byte, and absent values zero; arrays sum their elements, objects their own keys and values. This is logical Run and program payload size, not structured-clone encoding: framing, identifiers, timing metadata and other traffic are excluded. Writer wait uses physical monotonic time through grant, refusal or interruption; hold follows one physical lease through its existing release, including transaction controls and synchronous-level restoration. Nested transactions reuse that lease. A Run without a cause increments the pool's cumulative unattributed-statement count; the serving ledger exposes that count so a coverage gap is visible even when the caller has no ledger in its context. Span sampling never controls these counters. Standalone acknowledged replies also accumulate send-to-receive elapsed and child elapsed by cause. The pool's fingerprint census groups normalized SQL for standalone sends and carried program statements independently of spans; its explicit overflow row covers texts outside its bounded admission. Only standalone replies have statement timings, and neither elapsed measure is serving-thread CPU.