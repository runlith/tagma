---
id: 01a12d44-bb8a-71a3-8ca9-3968e0747d69
title: An act refuses with the stale refresh failure only while the tree has not changed since that failure
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
---
A failed tree refresh stores its cause and backoff (1 s, doubling to 5 min); `settled`, which every act awaits, answers with that cause and no fresh read only while the watcher stands and no observation arrived since the failed refresh (`observed <= failedSeen`). Otherwise the act starts a refresh at once. A team tree and its stealth layer share one mirror and each checks identity against the other's files, so a refresh that changed one is an observation of the other when the other stands failed: the stealth copy a layer merge removed ends the team tree's stale `duplicate-identity` at once.

Without this, a tree fixed right after the failure (an agent interrupted a `git merge` that left conflict markers in a graph file) refused acts with the stale "holds git conflict markers" cause until the backoff ran out — seconds or minutes, though the markers were gone. Background retries still await the backoff, so a "chatty" broken tree never spins refresh; only an act pays for an extra refresh. A tree with no watcher re-reads on every act: no changes are visible over it, and the old answer stands justified by nothing.
