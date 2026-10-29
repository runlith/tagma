---
id: 01a15433-0dde-7262-b10d-ee11d0cd5dfa
title: A sliced-rule read is stored by tree in the shared inspection cache, not in worker memory
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15417-b33a-7058-b932-71f2b7502f04
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/readings.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/slicing.ts
---
A sliced read is a function of the rule, the law area, the tree and the texts of the checkout's generated files the pack compares committed copies against (`compares`). The base reads only its tracked copies; the built side and whole-version measurements read the generated texts once in their first plan ask and pass them into every slice. Their cache keys include exactly those texts, which take precedence over inherited installed inputs when one path serves both roles. A generator rewriting its output mid-judgment cannot save a read under texts it never saw.

Installed configs aren't part of the key: which of them are needed only emerges during the read. So every plan and slice answer names the installed files its pass read. The server passes the accumulated set to the next asks of the same judgment, and the read is stored with the fingerprints of what its side read. A plan takes a stored read only when the checkout holds those files the same ([[edd30011]]).

The landing court puts both merged reads into the shared cache on the git common dir: the base without generated comparisons, the built side with the texts it verified. Only at that moment do the reads exist whole, because the server merges slices. A plan ask first looks for its tree's read at its own comparison texts.

Why: the plan and snapshot, listings and near-snapshots live in one worker's memory. Each pool keeps its own workers, and an idle worker leaves. `rest` keeps validity and listings, but not snapshots, so a landing on another or a fresh worker rebuilt the snapshot and listing even on a warm memo.

The built side asks the plan with `from` — the base commit whose read the server holds. When no generated comparison is declared, the worker answers `same` if the pack carries the read across tree differences ([[cdbbe012|carry rule]]). With generated comparisons, the built side runs its own slices so copy freshness is verified before any package contribution is reused. The read is stored and travels with its plan's byte budget. When changed-file growth exhausted the base budget, the worker builds a plan before `same` so the envelope refusal stays the same. Judgment on ready reads reads trees point-wise, with no full listings: on a fresh worker a full listing would cost more than the saved plan. Reads at measurement (`measures`) don't use the cache.
