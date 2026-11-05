---
id: 01a1a893-53a7-73ab-a1d6-7672fb6fd6bf
title: Terminal input ends on the holder's leader-exit fact even if a descendant keeps the slave open
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/holder-client/Connection.ts
  - kind: file
    ref: packages/execution-host/src/holder-client/Link.ts
  - kind: file
    ref: packages/execution-host/src/posix/Descriptor.ts
  - kind: file
    ref: packages/execution-host/src/posix/terminals.worker.ts
  - kind: file
    ref: packages/execution-host/src/posix/TerminalThread.ts
---
Linux can keep a PTY master writable while a descendant owns the slave, so writability cannot authorize input after the session leader's exit. The holder client's exit fact ends PTY input before that exit is exposed to callers, including adoption of an already-exited record. Its input gate is shared with the IO thread so queued thread messages cannot leave native writes authorized after that observation. Closing input leaves output drainable; pipe input has different ownership because descendants can continue reading it.