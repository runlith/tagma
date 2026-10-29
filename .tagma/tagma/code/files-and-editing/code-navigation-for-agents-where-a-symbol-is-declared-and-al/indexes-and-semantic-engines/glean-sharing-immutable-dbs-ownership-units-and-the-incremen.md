---
id: 01a16133-7eb5-779c-9a32-97e540bae4ba
title: "Glean: sharing immutable DBs, ownership units, and the incremental-recompute boundary"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "Glean — stacked incremental databases",
      "ref": "https://github.com/facebookincubator/Glean/tree/1255e7001ec321dca8e735c3eb2d2009c1ca3f94"
    }
  }
---
## Observation

Read `facebookincubator/Glean`, commit `1255e7001ec321dca8e735c3eb2d2009c1ca3f94`: DB creation/open, stacked lookup, ownership propagation/slices and the query wire. Glean stores typed facts by predicates; Angle queries run via `userQuery`, a separate API fetches a fact by ID. A DB has a name/hash, schema and properties; the hash may represent a commit but need not. This is a separate dimension of state from the working-tree path.

[Create.stackedCreate](https://github.com/facebookincubator/Glean/blob/1255e7001ec321dca8e735c3eb2d2009c1ca3f94/glean/db/Glean/Database/Create.hs#L221) resolves the completed DB as the base, takes firstFreeId from the base and creates a layer with a compatible schema. [rts/stacked.h](https://github.com/facebookincubator/Glean/blob/1255e7001ec321dca8e735c3eb2d2009c1ca3f94/glean/rts/stacked.h) routes lookup by ID between the base and the layer, looks keys up in both and applies ownership from the upper layer first. So several new DBs can independently reference one completed base without changing it.

An increment consists of the base's excluded units and the upper layer's new facts. A unit is an indexer-assigned string, usually a file/module. [Open.baseSlices](https://github.com/facebookincubator/Glean/blob/1255e7001ec321dca8e735c3eb2d2009c1ca3f94/glean/db/Glean/Database/Open.hs#L803) collects exclusions across the whole stack, reuses fitting slices and calls ownership slicing. [slice.cpp](https://github.com/facebookincubator/Glean/blob/1255e7001ec321dca8e735c3eb2d2009c1ca3f94/glean/rts/ownership/slice.cpp#L58) builds a visibility bitmap over ownership sets. Direct facts may belong to several units via OR; derived facts require the source facts' owners via AND. A dependency on a fact keeps it visible, so no dangling reference remains.

[ownership.cpp](https://github.com/facebookincubator/Glean/blob/1255e7001ec321dca8e735c3eb2d2009c1ca3f94/glean/rts/ownership.cpp#L506) computes ownership via temporary structures, flatten into dense/sparse mappings, propagation over the layer's facts and the affected base facts; the base uses a priority queue. So the layer needs no full copy of the base, but ownership also costs CPU/RAM. [Implementation notes](https://github.com/facebookincubator/Glean/blob/1255e7001ec321dca8e735c3eb2d2009c1ca3f94/glean/website/docs/implementation/incrementality.md) warn of the O(facts) propagation cost and lazily cached fact-owner pages. A large count of units/functions raises the count of ownership sets; a file- or module-sized unit is wiser than excessive granularity for this model.

The choice of changed units and the dependency fanout comes from the indexer/orchestration, not derived from visibility correctness. Hiding the facts of a changed file does not by itself recompute its consumers' semantics. The base+increments tree allows queries over several revisions at once, but gives no live TypeChecker and does not link local worktrees to a DB automatically.

There are various completeness signals. A DB lifecycle has Incomplete/Complete/Broken; queries are served even on an incomplete DB. [glean.thrift](https://github.com/facebookincubator/Glean/blob/1255e7001ec321dca8e735c3eb2d2009c1ca3f94/glean/if/glean.thrift#L419) sets max_results/max_bytes/max_time_ms with continuation and diagnostics. That signals a truncated query, separate from the DB status. Neither Complete nor an exhausted continuation proves the indexer covered all of the source.

[RocksDB.cacheSize](https://github.com/facebookincubator/Glean/blob/1255e7001ec321dca8e735c3eb2d2009c1ca3f94/glean/db/Glean/Database/Storage/RocksDB.hs#L79) supports a shared cache as a share of detected RAM, with fallback to an absolute size. Server config values such as 8000 MB shared cache are upstream defaults, not Glean's minimum consumption and not a fitting Tagma default. Memory also includes lookup caches, slices, ownership and the running indexer.

## Conclusion for Tagma

The useful principle is an immutable base with an isolated checkout overlay: one shared engine serves checkout agents, and one base can be shared between branches/worktrees. The overlay should hide stale facts by semantically affected units, and the TS7 adapter stays the owner of invalidation/fanout. One cannot promise O(changed files) from the mere presence of a DB stack.

Carrying over all of Glean and the AND/OR ownership early is not justified: the complexity is needed for genuinely shared/derived facts; simple independent document records can do with a smaller contract. Resource budgets should be derived from the machine, the count of active checkouts and the index size; coverage state and background incompleteness reach every answer regardless of pagination. This is a recommendation, not an implementation decision.

## Not established

The server and indexers were not run; RAM/latency/overhead of the stack were not measured. Numbers from the 2022 upstream blog were not reproduced and do not carry over to Tagma. Not established: the compaction strategy under continuous edits, the maximum useful stack depth, the exact TS7 fanout, building Glean on all target OSes, and the cost of storing many active worktrees. The research does not prove Glean fits as a built-in engine for a small machine.
