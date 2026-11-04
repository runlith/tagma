---
id: 01a12d3c-d1bc-76d6-aaa2-21424c940a20
title: Explicit paths select every changed file under them, whoever wrote it; a bare call selects the team's recorded files
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12d36-21ec-7231-9683-75c20f274db0
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/team.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/place.ts
    symbol: landingPlace
---
`paths` names files or directories, relative or absolute, and selects every changed file under them — tracked changes, deletions and untracked files from git status read without the fsmonitor — whoever wrote it, nobody included. Names that select nothing, or lie outside the checkout, come back in `unmatched`; a call whose names select nothing answers `nothing`.

A bare call selects the files the team's rows and retained command observations name that still differ from HEAD. The team is the caller and its descendants that are not running: a running child's files ride only when a carried file holds its rows. A command observation selects a file for the team but makes the observed thread no writer; writers are the threads whose held rows stand in a carried file. In a checkout whose `agent.checkout` is `single` a bare call selects every changed file. Before selecting, landing waits for the team's carrier commands to write their rows (see [[88f57477]]).

Selection never attributes authorship: it lists whole files, and the writers it finds in them are named in `carried`. A selected move source or destination brings the other path of the pair. Git-ignored files, nested repositories, `.git` and the graph store are never selected.

A caller whose writes the record never sees — a thread of another harness, a Claude Code session outside Tagma, the operator — has no team: it names `paths`, and a bare call refuses `no-record` rather than answering with an empty change (only a `single` checkout takes every changed file without them). It lands in the checkout where its call stands, and its commit steps and rules judgement run under its own actor, not the operator.
