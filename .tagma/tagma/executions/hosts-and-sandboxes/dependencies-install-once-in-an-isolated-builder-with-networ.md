---
id: 01a14c14-6895-75c6-80f2-47c7b28f1d15
title: Dependencies install once in an isolated builder with network only to named hosts, and are sealed into a prepared tree from which sandboxes start without network
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/sandbox/engine/docker/network.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/engine/docker/preparation.ts
  - kind: file
    ref: apps/tagma/server/src/sandbox/trees/preparedTrees.ts
  - kind: symbol
    ref: apps/tagma/server/src/sandbox/contract/wire/operations/tree.ts
    symbol: TREE_OPERATIONS
---
**Value.** A sandbox without network needs to download nothing: a tree with installed dependencies is built ahead, checked, and reused.

**How.** `build_prepared_tree`, `read_prepared_tree`, `release_prepared_tree`; the finished tree is passed to `prepare_sandbox`.

**Behaviour.**
- The builder goes to the network only to exactly named HTTPS hosts via a proxy in a private network; the build command does not grant itself network. With no host list there is no network at all.
- Network issuance ends before sealing; readiness checks run in an offline copy of the sealed bytes, and any failure publishes nothing.
- The tree records its origin: commit, image, platform, commands, digests of the dependencies, snapshot, and archive. It is reused by id, not by digest match.
- An image of its own can be named — it must carry Tagma's guest helper; a mismatched platform refuses.
- Release deletes the archive and build resources; already copied sandboxes are untouched, and copying already in progress is completed.

**Limits.** Docker is needed; a build can take many minutes. Builds abandoned by a server crash are marked failed at the next startup.
