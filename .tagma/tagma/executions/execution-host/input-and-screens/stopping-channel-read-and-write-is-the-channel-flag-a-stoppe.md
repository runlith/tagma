---
id: 01a129ab-1d7a-7957-9876-0909929695c2
title: "Stopping channel read and write is the channel flag: a stopped call answers `stopped`, taking not a byte"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/Descriptor.ts
  - kind: symbol
    ref: packages/execution-host/src/holder/Holder.ts
    symbol: Readable
  - kind: symbol
    ref: packages/execution-host/src/holder/Holder.ts
    symbol: Writable
---
Interrupting the fiber is no good for this: bytes the native read already took are lost when the fiber is interrupted after the call, and on write a lost count of departed bytes repeats them. So `stopReading` and `stopWriting` set a flag and wake the readiness wait, and the channel loop checks the flag before each native call and answers `ChannelFailed` with a `stopped` cause. A call that already took bytes answers with them; a synthetic interrupt echo is answered even after stopping — it is already in the adapter's memory, not in the fd; an echo waiting on bytes not yet read is given by `pendingEchoes` shifted from the read, and the successor returns it to the channel through `owe`. Removing the stop is impossible: only the leaving logic does it.
