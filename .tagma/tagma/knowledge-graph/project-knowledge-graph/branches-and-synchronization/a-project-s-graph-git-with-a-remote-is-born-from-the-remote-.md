---
id: 01a178f3-aa39-7f8d-b193-792863d0dbeb
title: A project's graph.git with a remote is born from the remote, whoever opens it first
ord: 9
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a178cf-eabb-7a2a-92d7-493ea4e99427
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/shadow.ts
    symbol: ShadowGit.open
---
The first to open `graph.git` may be not the graph-copy opening. A window subscription to recovery, detached reads, and storage moves also create the repository when it is missing. If only copy opening were born from the remote, a window subscription on a new machine would create an empty graph first, and recovery would silently become a new empty graph. So the remote address is a mandatory `ShadowGit.open` argument, and every opener passes the address from the project policy.

Birth from the remote goes in a side temp directory and lands by rename: an interrupted load leaves no half-repository, and the loser of a two-birth race deletes its copy. An empty remote gives an ordinary birth. An unreachable remote is an opening refusal; registration with such a remote rolls back and never births a graph that would never converge with the remote.
