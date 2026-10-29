---
id: 01a102b9-13e0-7284-8093-02b0eee0fccb
title: "Isolated admission measurement: full pass and in-act repeat"
ord: 1
---
2026-10-03, `bun src/workspace/roots/registry.bench.ts` from `apps/tagma/server`: a real Bun FileSystem and a separate SQLite fixture, K sibling roots in one temporary directory, one overlap; the server was not used, other agents' parallel work ran on the machine alongside. Six fresh resolves before the change gave medians of 3.83/12.94/167.06 ms at K=10/100/1000; after, 11.70/8.18/89.43 ms. Five repeats inside one scope after the first pass gave medians of 2.12/0.78/1.09 ms: each repeat does 4 stat and 2 realpath calls at any K, instead of 2K+12 stat and K+2 realpath before the change. EXPLAIN QUERY PLAN confirmed the range over `file_root_changes_idx (namespace_id=? AND changed_revision>?)`. This is a wall-time sample with a warm filesystem after registration; scattered roots and a running server are not measured by this experiment.
