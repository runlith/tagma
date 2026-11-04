---
id: 01a1a80b-8e92-79a9-a91a-d482a101b995
title: Native process ids are refused before an ABI conversion can wrap them
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/ProcessAbi.ts
---
The native process ABI has a signed process-id slot. Refusing an out-of-range identifier before Bun converts it prevents a requested nonexistent id from acquiring the kernel witness of a different live process.