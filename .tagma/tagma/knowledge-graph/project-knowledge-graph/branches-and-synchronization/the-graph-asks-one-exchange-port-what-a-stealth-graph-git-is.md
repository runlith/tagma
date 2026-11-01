---
id: 01a194cb-bf89-76a7-a97e-a9c917075e73
title: The graph asks one exchange port what a stealth graph.git is born from, which tracking refs topology follows and whom to wake; the core default answers none
ord: 23
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a193d9-9a1f-79e8-9f71-7a96e41dca93
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/service/exchange.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/exchange.ts
---
A stealth graph's exchange with anything outside the machine — a git remote, a self-hosted sync — is not the graph's: the graph asks one port, `GraphExchange`, and the filler a build carries answers. Per project the port answers its side — what a missing `graph.git` is born from, and the ref namespace whose branches stand for another machine's graph — and the graph tells it when to work: after a graph commit or an accepted refresh (`committed`) and when a copy opens (`opened`). The core default answers no birth, no namespace and ignores the wakes, which is the path a project with no remote always took, so a build without a filler serves every stealth graph alone.

The filler is built in the installation tier and receives the pool's host while the pool is being built, so it may call the host only after its factory returned — a host call inside the factory would reach a pool that is not whole yet. The host offers: the stealth `graph.git` of a project, branch following (the filler classifies local against tracked branches once with the graph's `relate`, and `follow` fast-forwards the behind branches no tree holds under the repository permit and says whether a held branch moved), `moved` for the trees whose topology must merge the namespace in, opening a project with its stealth layer attached, and setting the machine's graph aside for a graph taken whole, with the filler's own undo run inside the same exclusive section when the replacement fails. A side names its namespace even for a project with no remote: shadows keep the side they opened with for the copy's life, so a namespace that came and went with the address would leave an open copy deaf to a remote set after it opened; the price is one `rev-parse` per topology sync. Branch following, twins, topology and stealth-merge recovery stay the graph's and behave the same with or without a filler: topology only reads the namespace the side names, and with none it reads no tracking ref at all.

A side is answered synchronously and per call, because every opener asks it: the filler answers from what it already holds, never from a store read on each opening.
