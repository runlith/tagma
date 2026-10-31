---
id: 01a1931b-3868-7fed-9b97-60b734b3654c
title: A group block arrives on reads of a member's code without owning it
ord: 260
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a18d49-eba5-7e14-8517-20f9249b762f
  - kind: relates
    to: 01a18d86-336f-7de2-b13f-8260a36ba013
---
**Question.** Should a group block reach an agent when it reads a member's code, without owning that code?

**Motivation.** A source does two things at once: it makes its block the owner of a path, and it delivers the block to whoever reads or writes that path. A group block may not own member code (one path keeps one owner, in its member), so it loses delivery too. Knowledge about a seam between members — an API one member serves and another calls, a library and its consumer, a shared protocol — has a single subject but must arrive on either side's files. Today it is written twice, once per member, each sourced to its own side and linked by edges: the user has to know to do this, the two texts drift, and a member without its copy delivers nothing.

**Candidate.** Split the two roles of a source: ownership stays with the member holding the path, while a group block may carry a delivery-only anchor on a member path, so it arrives on reads and writes of that path and `read_owners` still answers the member's owner.

**What would inform the choice.** How often group users hit seam knowledge that must arrive on file reads in both members, and whether delivery following edges from the member's owner block would serve as well with less new mechanism.

**Uncertainty.** No group user beyond this installation yet; the need is inferred from what groups are for, not measured.
