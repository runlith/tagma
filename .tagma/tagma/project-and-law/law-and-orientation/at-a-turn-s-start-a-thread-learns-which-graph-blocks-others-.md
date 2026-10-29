---
id: 01a14c14-a11c-7ce8-9d84-6333615db78c
title: At a turn's start a thread learns which graph blocks others changed — its own and those standing on its files
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69423f034f23
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/message.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/orientation/digest.ts
    symbol: digestLayer
---
**Value.** The agent never works from stale knowledge: a colleague's edit in the task it holds or in the block about a file it wrote arrives by itself, while other people's matters never clog the context.

**How.** By itself, at the start of every turn of a native thread with the graph capability.

**Behaviour.**
- The list holds blocks changed since the last turn by other sessions when the thread touched or holds them, when its tasks link to them, when they stand in its area or on files it wrote; every row names the acts.
- Operator edits always show; the rest collapses to a row with block and session counts.
- The thread's own acts never show.
- Lost context returns the thread to full orientation.

**Limits.** Native threads only. Unreadable journal events are named, and the blocks they touched may be missing from the list.
