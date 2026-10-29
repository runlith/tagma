---
id: 01a16fff-02b8-7dd2-a860-dade16b2a9af
title: "Run-world and SQLite-pool measurement: 2.5× fewer bun starts, but CPU on 10 workers twice the single-process figure because the same work got costlier"
ord: 1
---
Measurements 2026-10-24/25, Apple M2 Max (8P + 4E cores), under other agents' load; each a single sample. Slice — 126 server-integration files (`x10/chunk4.txt` of the orchestrator), a separate testbed pool budget (`TESTBED_BUDGET_ROOT`) to get exactly 10 workers. Rows in the orchestrator's `x10/w-worlds.tsv` ledger.

**What changed in the worlds.**
- The host bundle builds once per `bun test` (run world, [[7c0fd0a0]]); the door world and terminal world offer a host from it ([[1d28d278]]). Earlier each such world spawned `buildArtifact.ts`, and under neighbors' edits the world hung in a hook up to 60 s.
- The graph world template carries the whole store, mirrors and trees included.
- SQLite children from the slice's test processes: 131–139 → 8 (12 itest plus the pool's own store recovery). The remaining 8 are the product's `platform/store/snapshot.ts`, which builds pools itself ([[3201be28]]).
- The seed cache is keyed by shelf: after `restart.itest.ts` every following SQL file of the worker failed (58 red in one run).
- Product telemetry in the door world's four-file profile — 1.2% inclusive, 0.7% own time: switching it off never pays, never done.

**10-worker CPU vs one.** After the changes, adjacent runs: one worker (two halves, load 8–22) — 133.8 s CPU, 608/608 green; 10 workers (load 5→43) — 285.8 s. Difference by article: load +17 s, world +46 s, tenant +7 s, body +94 s; git children +23 s at nearly the same start count: 5.05 ms CPU per git start at one worker vs 10.06 ms at 10. The same work on 10 workers costs about twice the CPU — conclusion: E-cores and core contention, not world duplication. Duplication (module loading and per-worker worlds) explains about 70 of ~150 s; the "248 → ~150 s on 10 workers" acceptance is unreachable through worlds while the work itself gets costlier from parallelism. Bun starts from test processes: ~200 → ~80, of them 40 program-rule starts (the tests' subject) and 12 `ensureServer` servers (subject).

Never measured: the E-core share directly (a process cannot be pinned to P-cores on macOS), a quiet run without other agents' load.
