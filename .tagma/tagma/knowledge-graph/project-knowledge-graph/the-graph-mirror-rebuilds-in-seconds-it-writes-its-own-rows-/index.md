---
id: 01a13ba2-803d-7614-a6da-35301e154af5
title: "The graph mirror rebuilds in seconds: it writes its own rows in pages, the owner derives derived tables in one set pass, search counts in a worker"
ord: 45
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/acts/derived.ts
  - kind: file
    ref: apps/tagma/server/src/graph/search/words.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/mirror.ts
---
Goal: a full rebuild of the graph mirror and any derivation of derived tables for many blocks run in seconds and do not load the server event loop. The number of SQLite calls grows with the number of pages, not blocks. Every derived fact — `block_tag`, `block_field`, `ref`, `search_index` — has one implementation, for one block and for a set.

## What the user sees now

On 2026-10-14 a child `exp-classes`, spawned with `worktree: "new"` (thread 01a13b39-13d7-7f4e-9246-c3c3447e2141), stayed silent for 89 s before the model's first step: the run started at 16:22:58.1, the first model call at 16:24:27.5.
- 83.5 s of it were one `Mirror.rebuild` transaction over the new worktree's mirror, 16:23:03.5–16:24:27.0 (trace `c2356e8e31c175f0a89e6e986bf513ef`): `Mirror.absorb` 25.8 s, then `Mirror.index` 57.6 s.
- The turn's context waits on this opening: `native-harness/turns/context.ts:166`, `graphAt` → `graph/serving/open.ts:503`, `rebuildMirror`.
- A neighbouring `effect-test` child at the same time waited on its own rebuild for 71 s (trace `5ad443eecd0de279d54ca376a7e`).
- Unloaded, `Mirror.index` ran 1–16 s over a day. Those are `read_performance` histograms, and they are incomplete: the store has losses.

## Why it takes long

Rebuild walks SQLite one statement at a time, and every statement is a round of Bun IPC to the mirror's writer process ([[96b75e80|SQLite beside the process]]) and back through the server event loop.

The runlith tree (measured 2026-10-14, one sample): 2992 blocks, 3455 sources, 3565 edges, 6250 block references in bodies, 8.7 MB of bodies, 13 `#tag`/`#catalog` declarations.

Estimated from the code over those counts (a calculation, not a measurement):
- `absorbMirror` (`graph/tree/mirror.ts:194–284`) inserts every block, every source and every edge with a separate statement — about 10,000;
- `indexMirror` (`mirror.ts:319–324`) calls `syncRefs`, `syncSearch` and `syncTags` per block (`graph/acts/derived.ts:32,94,113`) — 3–11 statements per block, about 30,000;
- about 40,000 rounds in total.

In the incident that is ~2 ms per statement, while SQLite itself executed the saved inserts at 0.01–0.5 ms (`db.exec.ms`). The rest is IPC and waiting on a busy loop: `db.queue.ms` reached 610 ms, loop latency p99 184 ms and max 432 ms. The cost multiplies by the statement count, so under load the rebuild stretches the most — exactly when several agents start in new worktrees.

Beyond the rounds:
- `syncTags` calls `Tags.forget` after every declaration, and the next `Tags.of` re-reads the dictionary (`vocabulary/tagTable.ts:58`) — up to 13 times per rebuild;
- `block_tag` is written three times: `projectTags` in absorb, again in index, and row by row a third time in `syncTags`;
- `searchProjectionOf` (stemming every body) runs on the loop interleaved with queries: 1.27 s CPU over the whole tree, the heaviest block 53.8 ms (measured in-process, one sample; the script was not kept).

## The fix

### 1. One derivation of derived tables over a block set

The owner of derived tables is `graph/acts/derived.ts` (`BlockProjection`, `BlockReferences`). It takes one input over a set of blocks of one project: derives the chosen facts for them (refs, search, tags and fields) and writes them in pages.
- Block rows and their sources read in id pages: one select per page, not one per block.
- The set's former derived rows are deleted in id pages.
- **Dictionary.** When the set holds a block that declares the dictionary or used to, the declarations' `block_tag` rows go first, then one `forget` and one `of`. The remaining rows take `typeId` and `block_field` from that one table.
- **References.** Names referenced by the set's bodies resolve in one read of candidates by `spokenTail` per name page. The matching is the same as now (`derived.ts:55–59`): the single project block whose dashless uuid ends in the name, trashed blocks included. One pure function, shared by set and single block.
- **Search.** The set counts projections with `searchProjectionOf` (`graph/search/words.ts`). A set whose text passes the loop search threshold goes to the search worker (clause 3); below it, to the loop. The threshold is search's own (`LOOP_TEXT` in `graph/search/counting.ts`), not the page's: stemming costs about 350 ms per million characters, while a page's synchronous part costs about 6 ms (measured in the task).
- **Writing.** `block_tag`, `block_field`, `ref`, `search_index` insert in multi-row statements in pages (clause 4). Tag, field and reference derivation goes in the same page as reading: declarations and dictionary once per set's project, the rest per page, so the synchronous loop pass is bounded by a page, not the set.
- **Full wipe.** `discard()` with no list erases derived tables whole: absorb empties the store, and rows written with foreign keys off must not outlive a rebuild.

`syncRefs`, `syncSearch`, `syncTags` and `syncBorn` stay the single-block inputs, but run as that same derivation over a one-block set. There are not two implementations of one fact ([[51c66cb6]]). Their spans keep the same names ([[c33e5cbc]]); the set derivation gets its own `BlockProjection.derive` span.

The set input carries:
- `indexMirror`;
- the loop of arrived files in `repairMirror` (`mirror.ts:573–609`);
- `completeDerived` (`derived.ts:172–202`) — on boot and on tree open (`serving/open.ts:299`).

Single acts (`blocks/update.ts`, `blocks/birth.ts`, `vocabulary/activation.ts` and others) do not change: they call the former methods.

### 2. Absorb writes its rows in pages

`absorbMirror` inserts in pages:
- `block` rows from the scan and the trash's saved rows;
- `source`, `edge`, `touch`.

Order and identities as now:
- block ids in uuid order;
- source ids consecutive in sorted order;
- dead edges in the answer;
- `supersedes` of trashed and superseded blocks is not carried;
- `recordTrash` and `rebatch` one journal row per subtree — the trash contract [[62d9a6f4]] does not change.

`projectTags` and the absorb dictionary (`mirror.ts:285–296`) stay: holder fields are set only on held blocks, and there are few of them.

`indexMirror` is `purgeUnjournaled`, one clause-1 derivation over every row of the project, `advanceLaw` and `advanceRevision`. Its own `projectTags` and `absorbedVocabulary` go away: the derivation itself writes declarations before the dictionary.

Index reads the project's rows in one select after absorb, although absorb just wrote them. That is one statement, and it leaves one input for rebuild and for indexing after graph steps (`serving/advance.ts:42`), which has no scan.

### 3. Search counts in the search worker

`graph/search` gets a worker that counts `searchProjectionOf` for a list of `{id, title, body, sourceRefs}` and answers with a projection list. The shape is a one-shot worker through `askOnce` (`graph/tree/oneShot.ts`), as the tree scan (`graph/tree/scan.ts`): no lifecycle of its own.

A worker failure is a typed derivation failure, and the rebuild refuses as on a store failure. A failure never becomes an empty index ([[ea465bed]]).

So 1.3 s of stemming over the runlith tree leaves the loop ([[7a910861]]).

### 4. The page

A statement carries no more than `PAGE_VALUES` bound values and no more than `PAGE_TEXT` characters of text; `pagesOf` cuts pages (`platform/store/binds.ts`), used by both derivation and absorb. Both constants live at the store, because they bound one statement, not one table owner. Their reason is the page's synchronous part on the loop: building the SQL, running the write check and fingerprint regex passes over its text, serializing parameters into IPC, deriving tags, fields and references. That part must fit threshold [[7a910861]] on the weakest machine Tagma serves ([[fe83acfa]]).

Measurement showed cost grows first with value count, not text: 32,766 values with no text — 29 ms; a 1M-character page with 7k values — 9 ms. So `rowsPerStatement` stays only the SQLite limit, and the page is additionally bounded by `PAGE_VALUES`. The numbers and the derivation of the constants are in the task.

The "worker or loop" threshold for search is its own (clause 1), not the page's.

## Why it is faster

- About 40,000 statements become dozens: the runlith tree is 2–4 block pages, 1–3 each for sources, edges and every derived table, plus pages by text. Time no longer multiplies by loop latency on every statement.
- The dictionary reads once per set, not after every declaration; `block_tag` writes twice, not three times: absorb's `projectTags` stays because holder fields and the graph steps between absorb and index (`serving/advance.ts`) read the dictionary before derivation.
- Stemming goes to a worker, parallel to the loop.

Expected (a derivation, not a measurement): scan 0.6 s and search 1.3 s measured here; writing a few dozen statements is fractions of a second. Goal: a runlith-tree rebuild no longer than 3 s on this machine unloaded.

## Why it is safer

- The mirror writer is busy for seconds, not minutes. Every act and read through that graph's write waits less. Standing SQLite handoff waits on a durable transaction to free the writer ([[15a15cc2]]), so an 80 s rebuild could delay a server restart by as much (a note's derivation, not a measurement).
- Rebuild no longer loads the shared loop with tens of thousands of rounds and stemming. How much that speeds other threads' steps was not measured: there was other load on the loop in the incident window.
- The single path and the set path share one implementation, so they cannot diverge. The set takes `typeId` from one dictionary table.

## Why it is cleaner

- Derived tables are derived by their owner, and the set shape is its own. The mirror no longer drives others' row-by-row methods in a loop.
- Search counting belongs to search and runs in its worker.
- The mirror writes only its own tables (`block`, `source`, `edge`, `touch`).

## What does not change

- The trash contract and the `duplicate-identity` refusal ([[62d9a6f4]]).
- Block and source numbering, refusal texts.
- Span names `Mirror.absorb`, `Mirror.index`, `Mirror.projectTags`, `Act.sync*`. Rebuild stops producing `Act.sync*` per block, and the commit names it ([[c33e5cbc]]).

## Rejected

- **A batch API in `@runlith/sqlite-process`.** It removes rounds, but the row-by-row reads each next step depends on do not batch. Triple `block_tag` writes, repeat dictionary reads and loop stemming stay. A new kit API for one caller.
- **Opening the graph ahead of setup wait or in advance, at worktree creation.** A turn waits on the longer of the two anyway: setup runs in the background. The run started 1.5 s after worktree creation, so early opening overlaps nothing, and for a worktree whose graph is unneeded it spends work.
- **A new worktree's mirror as a copy of the base's mirror repaired by diff.** The mirror derives from tree files, and a worktree's files are a clean checkout of its commit. The base mirror carries its place's state: journal, trash, task holders, head stamp and uncommitted graph edits of the base worktree. A copy would carry it into another place. Speed is the only argument, and this spec removes it.
- **The whole rebuild in a worker.** The mirror writer is already a separate process. A worker would need its own connection to the mirror — a second write path past `Act.unit`.

## Not included

- **Projecting one block's search on the loop.** The runlith tree's heaviest block took 53.8 ms — at threshold [[7a910861]]. An act projects one block, and that path does not change here. If confirmed on a weak machine, a separate task.

## Layers

- `graph/acts/derived.ts` — set derivation; single methods are its special case.
- `graph/search/words.ts` and a new search worker beside it.
- `graph/tree/mirror.ts` — absorb in pages, index through derivation, repair through derivation.
- `contract/service/acts.ts` — in the `BlockProjection` contract two set inputs: `derive` (derive chosen facts) and `discard` (delete derived rows of departing blocks, with dictionary `forget` when a declaration is among them). `discard` is called by absorb before wiping its tables and by `purgeUnjournaled` before deleting rows: foreign keys of derived tables otherwise forbid deleting a block, and the mirror writes no others' tables.
- `platform/store/binds.ts` — statement paging (`pagesOf`, `PAGE_VALUES`, `PAGE_TEXT`).

## Order

Clauses 1 and 3 are the foundation. Clause 2 does not depend on them. [[b01a5749|The turn-open phase spec]] is independent of this one.

## Acceptance criteria

The performer proves:
1. **Equality.** After `rebuildMirror` over the runlith tree, the `block`, `source`, `edge`, `touch`, `ref`, `search_index`, `block_tag`, `block_field` rows match before and after the change. Sorted dumps compare once, the result goes into the task. The old code leaves with the same change, so this is a one-off check, not a test.
2. Contract tests pass: `graph/tree/repairMatrix.itest.ts`, `composition/testing/graph/tree/mirror.itest.ts`, `graph/core/Act.itest.ts`, `composition/testing/graph/vocabulary/typeStorage.itest.ts`.
3. **Statement count.** The `rebuildMirror` statement count over the runlith tree before and after — from `sql.execute` spans or the store counter. After, it grows with pages, not blocks. Numbers go in the task.
4. **Time.** `rebuildMirror` over the runlith tree unloaded and with a second rebuild in parallel, before and after — samples in the task. Goal: ≤ 3 s unloaded.
5. **Loop.** Over the measurement window `read_performance` stalls show no stall overlapped by rebuild spans, and the page's synchronous part fits the clause-4 threshold (profile).

## What the operator checks

Not a task-close condition. A child with `worktree: "new"` takes its first step as soon as its worktree setup ends: the graph is no longer the longest part of the wait.
