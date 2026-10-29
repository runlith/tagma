---
id: 01a13be3-c9ba-795f-9f9f-43d2469a49ea
title: "Graph mirror rebuild: own rows in pages, derived tables in one set derivation, search in a worker"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13be4-18d8-7c1f-a28a-db5a931a8ae7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13ba2-803d-7614-a6da-35301e154af5
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/acts/derived.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/mirror.ts
---
Implement [[1e154af5|the mirror rebuild spec]] whole, clauses 1–4.

Why: a new worktree waited 83 s for a full rebuild of its mirror — about 40,000 statements, one by one over IPC and a busy event loop.

Start with: `graph/acts/derived.ts` — the set derivation, single `sync*` as its special case. Then `graph/tree/mirror.ts` (absorb in pages, index and repair through derivation) and the search worker beside `graph/search/words.ts`.

Done when the spec's acceptance criteria 1–5 hold and the commits are named by this task.

## Result

Commits d49d2c6dd8 (implementation) and 9082fcf760 (review fixes). The numbers below are taken on d49d2c6dd8; after 9082fcf760 equality, statements, time and loop were repeated — they are under "After review".

How it was measured: a script in the performer's scratch (not kept in the repository) assembles the same layer stack as `composition/testing/graph/tree/mirror.itest.ts` (mirror — `machineFileLayer`, writer — a separate `sqlite-process` process, as in the server), and calls `rebuildMirror` over a `.tagma` snapshot from `git archive` HEAD (HEAD dc6783a9b2, 3015 `block` rows, 9.0M characters of bodies). Statements are the sum of `db.writer.statements` at `Store.execute` of the outer transaction plus the `sql.execute` span count. Loop is a `setInterval(2 ms)` monitor, the longest gap over the rebuild. Machine — Apple M2 Max, 12 cores; "unloaded" could not be had: load average during all measurements 17–23 (other agents), so every number is a sample under that load.

**1. Equality.** Sorted dumps of eight tables before and after match row by row: `source` 3487, `edge` 3575, `touch` 0, `ref` 3914, `search_index` 3014, `block_tag` 2916, `block_field` 3268 — 0 mismatches. In `block` (3015) one row differs: the global-graph root, which the fixture seeds with a random uuid and time on every run; it does not depend on the rebuild code.

**2. Contract tests** pass: `repairMatrix.itest.ts`, `mirror.itest.ts`, `Act.itest.ts`, `typeStorage.itest.ts`; also all 70 itest under `graph/` and 23 under `composition/testing/graph`. `typeStorage.itest.ts` failed before the change: it held `shipped:tagma/tag`, while since 2220f6d0e7 the core library is `core` — the expectation was derived from `CORE_LIBRARY`.

**3. Statements** of `rebuildMirror`: before — 40,385 (`sql.execute` 40,386); after — 85. They grow with pages: the runlith tree is 2 block pages, 1 each for sources and edges, 9 `search_index` pages by text, 1 for each remaining derived table.

**4. Time** of `rebuildMirror` (no scan):
- before: 17.8 s and 11.1 s; two rebuilds in parallel in one process — 24.6 and 24.4 s;
- after: 2.66 s, 2.78 s, 2.80 s (three in a row, load ≈ 20); in parallel — 6.4/6.8 s, 11.9/11.4 s, 12.7/12.9 s, once 28.7/30.3 s at load 19–22. The ≤ 3 s goal unloaded holds in samples under load.
- Of 2.7 s: `Mirror.absorb` ≈ 0.45 s, `BlockProjection.derive` ≈ 2.2 s, inside it `Search.count` (worker) ≈ 1.3 s parallel to tag and reference writes, then nine `search_index` inserts ≈ 0.8 s.

**5. Loop.** A single rebuild after the change: longest loop gap 13–14 ms, none over 25 ms (before the value-count pages it reached 46–191 ms). With two parallel rebuilds gaps up to 440 ms, but two separate processes with one rebuild each showed the same 427 ms gap at one moment — that is the machine stalling as a whole under load 20, not the page's synchronous code. Checking via `read_performance stalls` on a private `tagma:try` instance was not done: building the instance refused on another's unfinished edit (`workspace/store/environments.ts` does not export `EnvironmentStore`).

**Profile of the page's synchronous part** (in-process, median of 5 repeats, one sample):
- `search_index` insert, 614 rows / 1M characters: 1.9 ms;
- `block` insert, 556 rows / 1M characters / 7228 values: 9.0 ms;
- `block_tag` insert, 10,922 rows / 32,766 values with no text: 29.1 ms;
- reference and tag derivation over a 1M-character page: 1.3 ms; parsing the same page's read answer: 2.3 ms;
- search stemming on the loop: 350 ms per M characters.

Constant derivation: a statement's cost grows with value count (≈ 0.9 µs per value: building the SQL, two regex passes over its text — the write check and the fingerprint — serialization into IPC), and text adds ≈ 2–6 ms per M characters. The weakest machine Tagma serves is taken as 4× slower per thread than the M2 Max, leaving ≈ 12 ms for a page here. Hence `PAGE_VALUES = 8000` (≈ 7 ms here, ≈ 30 ms on a weak machine) and `PAGE_TEXT = 1,000,000` characters (≈ 6 ms here with reading and derivation). The loop search threshold is `LOOP_TEXT = 30,000` characters (≈ 10 ms of stemming here, ≈ 40 ms on a weak machine); above it, the worker. The factor 4 is an assumption, not a measurement.

**Departures from the spec** (the spec is corrected in place):
- the page is additionally bounded by bound-value count, and the constants stand in `platform/store/binds.ts`, not at the derivation owner: the bound is a statement property, used by both derivation and absorb;
- the "worker or loop" threshold for search is its own, not the page's: stemming costs about 60× the page's synchronous part;
- besides `derive`, the `BlockProjection` contract has `discard`: absorb and `purgeUnjournaled` delete departing blocks' derived rows with it, otherwise foreign keys forbid deleting a block while the mirror writes no others' tables;
- index reads the body length, not the body: `unreadFields` needs only the length, and derivation reads bodies in pages.

## After review

Review: lead reviewer gpt-6.1-sol xhigh, lenses muse-spark-1.3-contributor xhigh — data equality and trash, transactions and races, test sufficiency. Fixed in 9082fcf760:
- index measured the body cap with SQLite `length()` (code points) while the contract cap is UTF-16: now index reads `length(cast(body as blob))` (UTF-8 bytes ≥ UTF-16 units) and re-reads the body only for blocks whose bytes exceed the cap; the cap test moved to a body with astral characters;
- `projectTags` cut `block_tag` by `rowsPerStatement` (10,922 rows, 29 ms): now `pagesOf`;
- the absorb page weight of blocks did not include the fields' JSON (one runlith block's fields — 1.86M characters): included;
- tag, field and reference derivation ran in one pass over the whole set: now declarations and dictionary once per project, the rest per read page;
- on a write failure the search-count fork no longer ran to the unit's end: `onError` interrupts it;
- absorb erased derived rows only of known blocks: parameterless `discard()` erases tables whole, as the former code did;
- tests added: `pagesOf` (order, bounds, a page-heavier row), indexing wipes unjournaled trash with its derived rows.

Not fixed, with reason: the global `built` cache in `tagTable.ts` outside the savepoint rollback — unchanged by this commit; `discard` before block deletion is ordered by foreign keys; double `block_tag` writes (absorb + derivation) — per spec, the spec corrected; `completeDerived` repairs only blocks without `search_index` — former behaviour; a worker-failure test would need a test-only seam; no separate test compares the single and set paths — both go through the same fact writers.

Remeasured after 9082fcf760 (load 14–17): eight-table equality the same (only the seeded global-graph root differs); statements — 135 (`sql.execute`): reads and references now in pages; rebuild — 2.71 / 2.73 / 2.87 / 2.91 s; two in parallel — 2.89 / 2.87 s; longest loop gap — 14–35 ms, none over 50 ms. In noisy minutes (load 19–29) the same runs gave 7.7–15.7 s with gaps up to 120 ms across all spans at once — that is the machine.

Spans: rebuild no longer produces `Act.syncRefs`/`Act.syncSearch`/`Act.syncTags` per block; new spans are `BlockProjection.derive`, `BlockProjection.discard`, `Search.count`. The remaining names are kept.
