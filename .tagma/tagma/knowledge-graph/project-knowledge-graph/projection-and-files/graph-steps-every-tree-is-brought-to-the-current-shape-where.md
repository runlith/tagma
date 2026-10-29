---
id: 01a0fe13-3076-72eb-b522-00d5583b23dc
title: "Graph steps: every tree is brought to the current shape, wherever it appears"
ord: 21
---
Graph files live in many copies: each branch's tree, each clone, old commits a merge brings in. So a stored-data shape change is a step in a permanent ordered list `GRAPH_STEPS` (`graph/tree/steps/`), not one-shot code at open. A step changes mirror rows: it finds the old shape and rewrites it, and does nothing on current data, so a repeat run is harmless.

The tree's `format.json` stores the last step passed (`{"step": …}`). A missing field means the tree has passed no step. A step the server does not know means the tree is newer than the server: it reads, but writes and catalog installs refuse. A step touching mirror-local state also keeps a receipt in that mirror: another copy's current tree marker cannot prove that this mirror's older writer rows were translated. Missing mirror receipts schedule those steps in the declared order, even when the tree marker is current; rerunning after a failure is safe.

`advanceTree` (`graph/serving/advance.ts`) runs the missing steps in two places. First — opening: after rows are taken from the tree, before the graph's branch merge (opening first only puts the tree on its branch and merges an already-brought tree) and before the catalog install. Second — every update after absorbing tree changes. Then it projects rows into files, rebuilds the mirror, writes the marker, and commits: a tree with its own git — at once, a team tree — hands its files to the graph's commit flow, which commits them on `graph.commit`. Mid-merge or another git operation, steps wait for it to finish.

Machine-store rows carry no marker, and the serving switch (`switchIfDue`, `graph/serving/attach.ts`) projecting them into an empty tree does not know their step: such a tree passes the steps at open. Exception — project birth (`GraphPool.birth` right after `ProjectLifecycle.create`): the current code just wrote the rows, so the switch puts the last-step marker into the tree itself — into the switch commit for a tree with its own git, after moving rows into the mirror for a team tree — and the first open does not scan, project, or commit the tree twice. A marker already standing in the tree is left untouched by the switch.

Merging a branch whose tree passed fewer steps lowers the marker to its step (`syncTopology`), and the steps run again over what was brought. Merges that git itself performs in team storage are outside this rule's sight.

A tag declaration defect does not drop the agent: instructions serve readable types and name the unreadable declaration as a separate record.
