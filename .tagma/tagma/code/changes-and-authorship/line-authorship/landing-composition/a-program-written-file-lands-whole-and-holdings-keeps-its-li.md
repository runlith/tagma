---
id: 01a14c85-f889-71f2-8933-7d04992e408f
title: A program-written file lands whole, and Holdings keeps its lines' authorship
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/hunked.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/programmatic.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/store/tables.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
    symbol: planPath
---
A program-written file lands whole in a commit, and Holdings keeps its lines' authorship.

Splitting a lockfile or generated file by author can assemble a state no program ever wrote. So prepared selects such a path whole before slicing, keeps the Holdings judge, and names the other holders in carried. The git `linguist-generated` attribute includes or excludes a path and takes priority over a lockfile name and record origin. Without the attribute, the marker is a known lockfile name or a command-recorded rewrite of the whole text area or opaque file, when this path's history holds no typed or unidentified record. Origin is stored with the record: after a commit or restart it is not guessed from the current lines, and old records without the marker stay unidentified. A partial command edit alone never makes a file program-written: a textual rewrite leaves no shared lines, and opaqueness follows the same content verdict as Holdings.
