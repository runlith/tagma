---
id: 01a14bc5-0df5-77c8-b1a2-694ce885261c
title: An agent with a graph gets graph tools and instruction sections on reading and writing it
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692f1e9ecb91
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694599fa9ace
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/doctrine
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/capability.ts
    symbol: graphCapability
---
**Value.** An agent with a graph works with it with no setup: it gets graph tools and instructions on how to read and write it, and an agent on a foreign CLI gets the same instructions through a managed AGENTS.md section.

**How.** The graph capability of an agent type. The "Project and its law" area owns the instruction sections and their delivery.

**Behaviour.**
- The most frequent operations are visible at once, the rest are found by tool search.
- Graph reads never ask the operator; writes ask in review mode.
- The checkout-and-graph section arrives only when the project dictionary declares a graph over code.
- Instructions tell to start from the project overview, to mention a block as a link, to lay large changes as one batch, and to carry out exits from a refusal.

**Limits.** An agent type without the graph capability gets neither tools nor instructions nor the project dictionary in the start.
