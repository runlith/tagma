---
id: 01a0c71b-6d2a-7c54-b6b0-5f34c852f964
title: A checksum segment counts exactly over the payload bytes its sealed bounds name, never over the file header
ord: 9
tags: ["rule"]
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
