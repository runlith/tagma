---
id: 01a1809e-a70a-70ca-a202-feaa4fc501f9
title: A tree file gone from disk is unreflected only while the mirror still holds a live block at its path
ord: 15
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/ledger.ts
---
Acts never move the tree stamp, so each refresh reads `stamped..HEAD`, which names the old path of every block an act retitled, moved or collapsed. Counted as unreflected, such a path ran a repair that changed nothing yet advanced the mirror revision, and the graph feed answered every subscribed window with `resync`: under a team of agents retitling blocks this was a resync every few seconds, each refetching the window's whole graph state. A path the mirror still holds is a real deletion or rename made outside Tagma and is repaired as before.