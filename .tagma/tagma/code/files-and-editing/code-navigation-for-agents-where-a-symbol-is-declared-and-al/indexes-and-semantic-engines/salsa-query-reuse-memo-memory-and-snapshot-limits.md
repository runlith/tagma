---
id: 01a16133-eee5-777f-8db6-f123467a1f1f
title: "Salsa: query reuse, memo memory, and snapshot limits"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Salsa 0.28.5 source checkout",
      "ref": "https://github.com/salsa-rs/salsa/tree/fc19bbe87882bff95b36d6ddca2b06582091cdbd"
    }
  }
---
Salsa `fc19bbe87882bff95b36d6ddca2b06582091cdbd` was read in `.external/salsa`; Cargo.toml declares 0.28.5. This is a separate checkout of the Salsa sources, not a claim of byte-for-byte match with the dependency built into rust-analyzer. No launches or measurements were taken.

**Model.** A tracked-function call consults the memo by request id. `fetch` checks cancellation, looks for a current memo, records the use for eviction, and reports a tracked read with `durability` and `changed_at` to the local request stack. The hot path reuses a memo after shallow verification. The cold path coordinates concurrent computation of one key: if another worker already computes it, the reader waits for that result; otherwise it checks the old memo's dependencies and only then runs the function. This is a runtime for demand-driven computations with a dependency graph, not a ready-made source-code index or file watcher.

**Update granularity.** It is set by the author of input fields and tracked functions. Salsa does not know what a line, file, function, or git commit is. A coarse input widely invalidates its consumers; small queries and comparable intermediate values localize the work. After computing, the new result is compared with the old via `values_equal`; `backdate_if_appropriate` keeps the old `changed_at` when the value is equal and durability did not weaken. Provisional/cyclic results have separate restrictions — equality does not always allow backdating. This is early cutoff of change propagation, not mandatory recomputation of all dependent nodes after every edit.

**Memory.** A memo holds a header with revision/dependency metadata and an optional cached value. `evict_value_from_memo_for` sets `value = None` for an eligible memo, keeping the memo itself. So evicting a large result does not delete the whole dependency history or input/interned data. The eviction policy is chosen for a tracked function; it gives no whole-process byte quota. Held state depends on query shape, keys, results, and the program areas used. A global RSS budget not found in this reading is not enough to promise work under any RAM size.

**Readers and changes.** `Storage::clone` shares the handle but creates a new `ZalsaLocal`. `cancel_others` raises cancellation and waits until the live-clone count drops to one, then takes mutable shared storage. This shares computation between threads of one base, not a cheap independent fork for a branch. A reader long holding a clone affects mutability. A query version is the base revision; it is not a git SHA.

**Completeness.** Salsa tracks only dependencies declared as inputs and read through its API. It does not derive missing dependencies from program text and returns no navigation coverage to the user. A wrong dependency boundary or untracked state can leave the semantic layer incomplete regardless of sound memoization; the completeness contract must be set by the analyzer itself.

## Conclusion for Tagma

Salsa is useful as an architectural model when Tagma itself owns derived facts: versioned inputs, dependency on actual reads, an equal intermediate result stopping invalidation, shared computation of the same query. It is no grounds for writing a second semantic engine around TS7, nor a ready-made shared index store for worktrees. Different checkouts need independent inputs/views; sharing immutable artifacts needs its own proven key including the semantic environment, not just matching text or commit. Weak laptops need separate lifetime and data-cost measures; evicting a result does not free all of the query's state.

## Not established

Perf, scheduling fairness, behavior under a continuous edit stream, metadata size after eviction, and long-process stability were not checked. The whole serialization API and third-party extensions were not studied; from the `Storage`/memo read, ordinary clones are not independent — but no mathematical impossibility of building branching views over Salsa follows. No numeric RAM or time limits follow from this.

## Sources

- [Source version](https://github.com/salsa-rs/salsa/blob/fc19bbe87882bff95b36d6ddca2b06582091cdbd/Cargo.toml#L1-L9).
- [Fetch, tracked read, memo verification and coordination of identical queries](https://github.com/salsa-rs/salsa/blob/fc19bbe87882bff95b36d6ddca2b06582091cdbd/src/function/fetch.rs#L15-L157).
- [Backdating with equality and durability conditions](https://github.com/salsa-rs/salsa/blob/fc19bbe87882bff95b36d6ddca2b06582091cdbd/src/function/backdate.rs#L15-L59).
- [Eviction keeps the memo header](https://github.com/salsa-rs/salsa/blob/fc19bbe87882bff95b36d6ddca2b06582091cdbd/src/function/memo.rs#L87-L123).
- [Writer cancellation and shared-storage clone](https://github.com/salsa-rs/salsa/blob/fc19bbe87882bff95b36d6ddca2b06582091cdbd/src/storage.rs#L152-L190), [Storage::clone](https://github.com/salsa-rs/salsa/blob/fc19bbe87882bff95b36d6ddca2b06582091cdbd/src/storage.rs#L259-L282).
