---
id: 01a128bb-4d99-7517-84e7-4bc97bc02a59
title: The program environment bypasses the trampoline's environ and shares the channel with exec status
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/holder/src/posix/spawn.rs
  - kind: symbol
    ref: packages/execution-host/native/holder/src/posix/mod.rs
    symbol: settle
---
The macOS loader may drop DYLD variables from the intermediate image's environ before its main. So the trampoline receives the passed env bytes over a dedicated environ channel and hands them directly to execve. One duplex socketpair serves both large-environment async transfer and launch confirmation. Env starts with a payload length: an early EOF never turns a partial environment into a launch. The holder's write end completes env, the helper's CLOEXEC-end close confirms exec, and a startup error returns on the reverse side of the same channel.
