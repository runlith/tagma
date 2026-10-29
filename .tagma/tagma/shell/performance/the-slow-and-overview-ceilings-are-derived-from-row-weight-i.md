---
id: 01a13f75-241d-7787-9ca3-897406378a12
title: The slow and overview ceilings are derived from row weight in the tool envelope
ord: 28
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/protocol/queries.ts
  - kind: file
    ref: packages/performance/src/reports/overview.ts
  - kind: file
    ref: packages/performance/src/reports/spans.ts
---
`slow` and `overview` serve the 50 KiB / 2000-line tool envelope; 2048 bytes / 64 lines are reserved for metadata and cursor. Pretty-JSON calibration with the operation response nested: a CheckoutStatus.reading span with its checkout attributes is 856 bytes / 25 lines; a series with 34 histogram bounds and every incompleteness reason is 1805 bytes / 94 lines. The minimum of the byte and line quotients gives 57 and 20 records. One span's arbitrary attributes may be heavier than the sample; spooling keeps such an answer whole. `total: null` means the full population was never counted: a cursor, a cut page, or the overview budget do not justify a new pass for the number.
