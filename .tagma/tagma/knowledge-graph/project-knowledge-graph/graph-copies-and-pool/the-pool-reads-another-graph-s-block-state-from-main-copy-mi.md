---
id: 01a159e6-fadb-7fbf-baee-4e9b6c05ddf7
title: The pool reads another graph's block state from main-copy mirrors in one message to the worker, and never opens a foreign copy for a read
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/service/foreign.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/foreign.ts
---
`farStates`, `farPointing`, `farOutgoing` and `graphRootOf` (`serving/foreign.ts`) ask the copy-index worker: it reads the mirror root of each main copy and queries over the roots found. The mirror is an index its copy's owner maintains on every write (`far_edge`, blocks, phase words in `meta`), so reading a block, an edge, a task or a project takes no pool permit of a foreign project, waits on no permit, and does not rush its refresh: the copy answers with what it has written by this moment. The "root → project" map is not cached: a recreated or recloned graph would otherwise answer with the former project.

A copy that has no index yet (a mirror older than `far_edge`) or whose phase words are unpublished answers honestly: incoming edges from it go to `unread` (`read_block` returns them as `edgesInUnread`), the target's phase is unknown, and such a target holds the task; an unread root of the project itself gives `read_project` an `unread` count, not zero. The same answer asks the pool to open those copies in the background (`warm`): in the background class of the opening lane, one attempt per pool lifetime — a refusal is not repeated by every read, and only the project's departure from the pool lifts it. Opening publishes the phase words, and the next read judges. Waiting on the read path for opening is not allowed: after a server restart every copy rises in the opening lane, and reading one block would wait on them all.

Any "no" here is one `absent` state with a reason (`project`, `block`, `unreadable`); two projects with one root are `ambiguous`. None of them changes an edge: Tagma frees or deletes no edge itself; only an explicit `unlink` removes one.

Within one read, `Selection` (and `ready_work` whole) measures a project's external block set once (`ReadFarMarks`); outside a read, measurement takes only the address edges of the measured blocks. References `[[…]]` on a block's page that are not in its own graph are found by `elsewhereNames` with one `titles` question with `settle: false` over the indexes of global and the rest of the projects at once; a name found in global is taken from there. Opening global for a reference is no longer a read's right: while its index is unbuilt, the name is named neither found nor missing.
