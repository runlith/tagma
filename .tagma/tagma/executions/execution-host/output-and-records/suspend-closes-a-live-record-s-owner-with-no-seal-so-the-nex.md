---
id: 01a129a8-7e78-7c08-a267-60002f9b8cd1
title: Suspend closes a live record's owner with no seal so the next process can continue it
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4eca5084ccfe
sources:
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: SegmentRecord.reopen
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: SegmentRecord.suspend
---
Ordinary owner finalization seals the record; handing a live execution over and refusing its assembly after a successful reopen demand suspend before scope close. Otherwise the next process meets a finished record while the child is still alive. Suspend stops intake, awaits the already taken write hurrying it with the carrier deadline, and frees handles; the next owner restores the unclosed segment's frontier by its payload. A stream whose write failed suspend first ends in the journal with error at the confirmed frontier: such a segment's payload can carry bytes past the frontier, and the next owner must never take them.
