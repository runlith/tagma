---
id: 01a16a45-80a3-7fe9-ab8d-049957234296
title: The pool remembers the entry place only while repository-topology observation stands; any movement of its checkouts or branches wipes the project's memory
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/places.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/watch/topology.ts
---
So a finished copy is served without a per-call cwd git read, the pool remembers which place — checkout, storage layer, detached-ness — each entry gave (project, cwd, branch). The memory holds only while every change arrives as an event: the project's shared git-directory observation in workspace (`CheckoutRows.checkoutsMoved`: main `HEAD`, `worktrees/<id>`, branch refs). Any of its elements wipes the project's memory.

While no observation stands — in a world without an observer, after a loss and before reopening — the pool remembers nothing and reads the place anew on every entry. An observation whose root folder is gone ends instead of reopening on a timer, and the pool follows that root again only at its next remembering; a folder holding no repository waits on its own `.git` appearing. Reopening forever on a timer cost every deleted or folder-only project a git spawn and a warning each minute for the server's whole life. A place computed before an event is never kept: it is checked against the project's epoch, which every event raises. Removing the project, changing policy or registry, also wipes the memory. The memory is bounded in entries: there can be any number of different cwds.

A copy whose checkout is gone simply stops being any entry's place and closes on T. If a place's detached-ness diverges from how the copy is opened, the next place pick drops the copy and reopens it.
