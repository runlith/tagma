---
id: 01a102b3-ba7f-7132-b85f-b3581df4b013
title: Command admission holds a roots snapshot for one act
ord: 3
---
The first admission in command scope physically checks the whole namespace registry: an external ancestor rename with a symlink at the old place cannot be proven from a stored path. The scope holds that snapshot and the identities/ancestry index; a repeated path re-checks previously crossed roots and changes past its revision. FileRootStore marks registration, replacement, retirement, relocation and git-facet change with a revision; changesSince reads the delta with one indexed query. Foreign changes never interrupt an act; a new overlap or a disappearance or move of its root needs a new admission. ExecutionTargets keeps the scope for the SpawnAnnotation lifetime for support commands of one tool act, and admittedGit for one git act. Acquire re-checks the already admitted footprint before reservation.
