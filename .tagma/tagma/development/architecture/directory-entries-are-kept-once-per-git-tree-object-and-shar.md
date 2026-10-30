---
id: 01a18e2f-f37c-705f-89d9-1d316dbc5151
title: Directory entries are kept once per git tree object and shared by every revision
ord: 29
tags: ["explanation"]
sources:
  - kind: file
    ref: checks/law/directories.ts
  - kind: file
    ref: checks/law/store.ts
---
Directory entries are kept once per git tree object in the shared law store (`store.ts`, tables `nodes` and `roots`), so a base, its candidates and every checkout of the repository share the nodes they have in common. Only a changed directory costs a new node; the catalogue never holds a path map per revision, and a lookup walks one node per path component, never one git process per directory.

A revision is catalogued only after every directory below its root tree exists in the store; `roots` records the root tree id of such a revision and is written together with the missing nodes. The presence check of every child, the writes and the aliasing of a known tree to another revision happen inside one write transaction, and so does a sweep's reachability read and deletion, so no root can be published over a directory a concurrent sweep removes and no sweep can remove what a concurrent publication relies on. The explicit remeasure (`prepare` with no base) seeds the whole catalogue from one recursive listing that includes tree rows. A judgment of a change derives its own revision from the base's catalogue: the changed trees come from `diff-tree -t`, their entries from one batched `cat-file`, and unchanged directories stay as they are. A base nobody catalogued before derives from the nearest catalogued revision; with none near, the judgment asks for the remeasure instead of scanning.

Nodes are plain git facts, so the parser-version reset that clears the declaration index does not touch them. A revision that has a catalogue answers every probe from it, and a node that is missing fails naming the remeasure; only a revision that was never prepared keeps the bounded per-directory git lookup of `sideTree`. The implementation files of the catalogue are part of the architecture programmes' cache version, because they decide which paths a probe sees.
