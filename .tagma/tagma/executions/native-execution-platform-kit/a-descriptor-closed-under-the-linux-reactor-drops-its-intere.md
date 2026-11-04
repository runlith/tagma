---
id: 01a1a83a-71e3-7b08-a22d-f08d0ed9d1d7
title: A descriptor closed under the Linux reactor drops its interest instead of failing the reactor
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/src/linux/readiness.rs
---
epoll keeps one one-shot registration per descriptor for both directions, so after a read event the reactor re-arms the write interest still wanted. The logic may close that descriptor between the wait and the re-arm, and the re-arm then answers EBADF, or ENOENT where the number already names another file. Those two answers drop the interest, as closing a descriptor drops its filters on macOS; any other failure still stops the reactor, which every waiter then sees.