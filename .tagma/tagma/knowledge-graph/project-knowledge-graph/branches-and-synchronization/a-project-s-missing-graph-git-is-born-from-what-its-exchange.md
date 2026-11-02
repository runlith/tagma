---
id: 01a178f3-aa39-7f8d-b193-792863d0dbeb
title: A project's missing graph.git is born from what its exchange side names, whoever opens it first
ord: 9
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a179a7-5ae0-7899-b62e-35cda941dfc7/01a178cf-eabb-7a2a-92d7-493ea4e99427#runlith-private
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/shadow.ts
    symbol: ShadowGit.open
---
The first to open `graph.git` may be not the graph-copy opening. A window subscription to recovery, detached reads, twin renames and storage moves also create the repository when it is missing. If only copy opening were born from the exchange, a window subscription on a new machine would create an empty graph first, and recovery would silently become a new empty graph. So `ShadowGit.open` takes the project's side of the exchange port as a mandatory argument, and every opener passes what the port answers for that project; a team project's stealth layer is attached when its `graph.git` stands or the side names a birth.

Birth goes into a side temp directory, which the filler fills with heads, and lands by rename: an interrupted load leaves no half-repository, and the loser of a two-birth race deletes its copy. A birth that brings no head gives an ordinary birth. A failed birth is an opening refusal; registration that births from an unreachable source rolls back and never births a graph that would never converge with it.
