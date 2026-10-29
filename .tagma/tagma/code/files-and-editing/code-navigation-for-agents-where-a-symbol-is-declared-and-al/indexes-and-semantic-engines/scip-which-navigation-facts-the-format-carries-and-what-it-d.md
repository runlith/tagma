---
id: 01a16133-7d71-77d3-baf3-413218b3e3f3
title: "SCIP: which navigation facts the format carries and what it does not guarantee"
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "SCIP",
      "ref": "https://github.com/sourcegraph/scip/tree/fcb3cb3c679fe2da18141550f864b9e67afab297"
    }
  }
---
`sourcegraph/scip`, commit `fcb3cb3c679fe2da18141550f864b9e67afab297`, was read, above all [scip.proto](https://github.com/sourcegraph/scip/blob/fcb3cb3c679fe2da18141550f864b9e67afab297/scip.proto). This is a navigation-fact exchange format, not a query server and not an update algorithm. An `Index` holds metadata, documents, and information about external symbols. A document sets a relative path, occurrences with a range and symbol ID, symbol definitions, and relationships. A global ID includes scheme, package manager/name/version, and descriptors; a local ID is scoped to one document. Text and position encodings are declared separately: UTF-8 bytes, UTF-16 or UTF-32 code units must not be mixed.

`SymbolRole.Definition` distinguishes a declaration from a reference; relationships separately include linked symbols in references, implementations, and type definitions. These relations differ: a class implementation need not become a reference to the interface. The schema has no "call" role and no standalone caller→callee edge. `enclosing_range` can help build a call hierarchy, but it is an optional field of the nearest non-trivial AST node, not a promise of a ready call list. One occurrence/symbol pair alone is not enough to distinguish reading a function from calling it for exact `callers`.

The protocol requires streaming-friendly order: metadata once at the start, then fields may come in chunks. That allows loading without holding the whole protobuf Index in memory. A document stays the unit of useful serialization; it does not follow that a compiler can recompute only one document. The current schema commit carries typed range/enclosing range alongside the deprecated repeated-int encoding: consumers must handle the version and prefer the typed field.

Metadata has no commit, environment fingerprint, excluded-file list, completion status, or completeness certificate. Optional diagnostics attach to an occurrence. A file with no occurrences, a skipped file, and an unsupported language cannot be told apart by a missing result. Indexing by a heuristic producer is allowed, so the word SCIP alone does not guarantee compiler accuracy.

## Conclusion for Tagma

SCIP fits as a possible portable snapshot of facts a language adapter already computed, not as a replacement for the live TS7 API. The stored view must keep implementations separate from references, and reference/call apart. Commit, configuration and dependencies, document revision, coverage, and the reasons for incompleteness need their own index-owner contract.

Worktree sharing is possible at the level of identical immutable artifacts only with a compatible semantic environment. Equal symbol IDs do not prove that two checkouts have the same types and import resolution. The format does not decide that sharing.

## Not established

No indexer, server, runtime, project files, or benchmarks were launched. RAM, query-tier size, dedup share, and load cost were not measured; 32 MiB is one upstream batch constant, not a common memory budget. Live updates of uncommitted files, automatic sharing of the TS compiler heap across worktrees, and completeness of the latest Sourcegraph version are not proven. Recalculation granularity after an edit belongs to the external indexer, not to SCIP storage.
