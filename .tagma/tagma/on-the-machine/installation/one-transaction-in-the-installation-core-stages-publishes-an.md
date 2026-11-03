---
id: 01a1a25c-7026-7f0c-99ee-85be9d866eee
title: One transaction in the installation core stages, publishes and makes a version current for every adapter
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a43-7a67-8046-6e8a2efb5b64",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a13234-e0d0-7863-b40d-c3e12043c3ca
  - kind: relates
    to: 01a13283-fc95-76c8-a601-3f5eac2d9a04
---
The install transaction was written twice: the release channel staged under a lease and a lock, while the checkout build wrote a visible `install/<ts>` with neither, so two builds pruned each other and `current` could point at a removed directory. `current` had four writers, "the release before" was computed three times, and "Back" twice, with only one of them writing `returned.json`. The installation core owns the lock, the hidden stage under lease, publication by rename, the attempt policy, the swap, the typed prune, the step back and "previous"; the release channel and checkout builds call it.