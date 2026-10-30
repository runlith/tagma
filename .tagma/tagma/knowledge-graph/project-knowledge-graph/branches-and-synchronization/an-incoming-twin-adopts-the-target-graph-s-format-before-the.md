---
id: 01a13177-f9f5-71bb-a671-b074491f9937
title: An incoming twin adopts the target graph's format before the text merge, and blocks born in the process take the target's identity
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/mergeFormat.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/open.ts
    symbol: makeMirrorBuilder.prepare
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/topology.ts
    symbol: levelled
---
Branches pass graph steps and dictionary updates at different times; without adoption, format differences turn into false text conflicts. The incoming twin and a lagging team branch adopt under one owner in a temporary tree and temporary mirror: steps, projection, dictionary. The resulting commit merges, while the source branch never changes during verification. A branch with no graph yet merges as is; an existing tree without a marker counts as the old format. The same adoption reads a detached checkout's own tree; the temporary tree and mirror release with the pool record. In stealth without its own tree, the detached place reads the main checkout's copy and creates no separate snapshot. Attach and topology are skipped because the temporary copy creates no branches and no twins; the repository permit is never retaken while sync already holds it. An adoption also descends from the preceding adoption of the shared raw source commit that the target already contains. That prior tree must become the next merge base, or resolving a format conflict would be lost whenever the source adds unrelated knowledge.

Steps and dictionary installation give new blocks — module cards, catalogs — fresh uuids, while the target started its own for the same entity. Without reconciliation they would collide as add/add or double. So a born block that has exactly one block in the target tree with the same parent (after the same parent reconciliation), title, and tags takes the target's uuid, and links to it are rewritten. Born blocks must never be deleted: a step like module-cards already erased the inputs they could rebuild from. A pairless block stays — it is knowledge the target lacks.

After a clean merge the `format.json` marker drops to the lesser of the merged commit's and the target's steps: the adopted commit carries the latest step, so the floor is set by the target's own step — adoption never touched its blocks, and if the target lags they pass the steps at the next opening. The twin's raw-tip step never reads here: otherwise a target on the latest step would re-run all steps, scan, and projection after every merge. If adoption failed, the twin merges as is, with a log warning: graph sync never stops over it.
