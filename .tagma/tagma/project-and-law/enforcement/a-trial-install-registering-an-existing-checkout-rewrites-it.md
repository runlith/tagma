---
id: 01a123b8-32bc-71eb-801f-04f0680f8d02
title: A trial install registering an existing checkout rewrites its .git/tagma/merge-driver to its own temporary CLI
ord: 159
tags: ["task"]
fields:
  {
    "holder": "tagma:01a123aa-3d04-7529-8b9c-1af758cf819e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12393-b963-7331-8878-35262d90b3af
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/mergeDriver.ts
---
On accepting succession `tagma:try` with automatic `add_project --storage stealth` rewrote `/opt/workspaces/runlith/.git/tagma/merge-driver` to the temporary install runtime and CLI in `/var/folders/.../tagma-succession-*/install/current` on the main runlith checkout. When the temporary directory is deleted, the driver silently falls back to `git merge-file` instead of graph merging. A checkout belongs to the install that registered it first; an isolated instance must not hijack its merge driver. Done when a test shows: a second install registering an already served checkout does not change its merge driver (or `tagma:try` does not register someone else's checkout), and the owning install restores the driver to itself on its own startup sweep. One Sol xhigh review found a bypass with an external and missing `core.hooksPath`; both scenarios were separately reproduced red→green and closed by writing the owner into the driver under one shared gate scheme. Server typecheck and 11 narrow tests passed. The working server and its git hooks were not changed in this task.
