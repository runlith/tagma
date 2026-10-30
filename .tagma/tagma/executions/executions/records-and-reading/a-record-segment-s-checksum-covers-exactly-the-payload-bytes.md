---
id: 01a0c71b-6d2a-7c54-b6b0-5f34c852f964
title: A record segment's checksum covers exactly the payload bytes its sealed bounds name, never the file header
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/executions/src/recordFormat.ts
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: sealStream
  - kind: symbol
    ref: packages/executions/src/RecordFiles.ts
    symbol: verify
  - kind: symbol
    ref: packages/executions/src/recordFormat.ts
    symbol: crc32Update
  - kind: symbol
    ref: packages/executions/src/recordFormat.ts
    symbol: SealedSegment
---
Sealing and verification must count the same span; a checksum that includes the header would fail verification of a segment whose payload is intact.