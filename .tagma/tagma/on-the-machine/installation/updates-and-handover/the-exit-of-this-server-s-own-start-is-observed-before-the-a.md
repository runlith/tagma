---
id: 01a17aec-3788-7a13-ac1f-1c67251558a3
title: The exit of this server's own start is observed before the absence of the directory holder
ord: 9
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/installation/process/serverStart.ts
    symbol: awaitStart
---
A start failure joins the child process exit, the directory holder's absence, and the server's silence. These observations are not atomic: while the health request awaits an answer, another start may take the directory while ours exits over the busy directory. The exit is read first; otherwise the old holder absence together with the fresh exit would wrongly turn away a client that must wait for the winner.
