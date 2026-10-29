---
id: 01a17c33-a6e1-7033-9154-8ad29ca4bc9e
title: A byte-exact PTY fixture prints CRLF with no kernel output conversion
ord: 3
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/execution-host/src/nativeLaunch.itest.ts
    symbol: PRINTER
---
When the tty queue fills, XNU can add a CR, fail to fit the next LF, and on retry of the original LF add another CR. So the fixture source disables OPOST and prints CRLF itself: the byte-preservation check at handover does not depend on kernel line conversion and still compares the whole stream byte by byte. The cause is visible in [XNU ttyoutput and ttwrite](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/tty.c).
