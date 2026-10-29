---
id: 01a128f3-2660-7b02-bb52-7f08834c93bc
title: The fallback interrupt echo preserves the boundary of already queued terminal output bytes
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/Descriptor.ts
  - kind: symbol
    ref: packages/execution-host/native/src/channel.rs
    symbol: interrupt
---
TIOCSIG delivers the interrupt on full input but creates no echo, so the adapter adds it into the same stream, behind a snapshot of the already queued output bytes. On macOS TIOCOUTQ gives the snapshot: FIONREAD on the master reflects the tty input queue. The reader stops reading at that boundary, otherwise the echo could split a later UTF-8 or control sequence. NOFLSH preserves the previous output; when the queue is flushed, stale synthetic echo is dropped too. ECHOCTL selects the caret form, and EXTPROC excludes such echo.
