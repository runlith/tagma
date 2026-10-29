---
id: 01a1366a-82cb-7d9f-8a0f-dd23d11df7cd
title: Full graph-to-tree projection (projectToTree) walks files synchronously on the server loop and stalls it for 0.2–0.9 s
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13675-2e34-7dd7-be20-c193361cae49",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1362d-a0db-7666-88df-6b9d95a079fc
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/projection.ts
---
`projectToTree` (`graph/tree/projection.ts`) renders the project's whole graph and checks every `.md` of the tree with synchronous `readdirSync`/`readFileSync`/`existsSync` on the server loop. This breaks the rule against unbounded computation on the loop: the cost grows with the project's block count.

**Evidence (server pid 64146, 2026-10-13 16:19–16:22 UTC, build 20261013T135707182Z):**
- Stall `f100b357` 870 ms, `c06c80c5` 665 ms, `26983b25` 642 ms, `b84be1b5` 439 ms — a `readdirSync` frame; profile `edad9394`: 73 of 177 samples inside `projectToTree` (`applyTreeFiles` 70, recursive `prune` 29), plus `renderBlockTree`/`encodeBlockFile`.
- Stall `50dfd16f` 195 ms (`readFileSync`); profile `463c095b`: again `applyTreeFiles` and `renderBlockTree` (~400 ms by weight in the profile window).
- The pass has no span, so the caller cannot be found via telemetry. Candidates by code: twin adoption before a worktree merge (`serving/open.ts` → `adoptIdentities`), `advanceTree`, storage switching (`attach.ts`), `rewrite_graph_files`. `archive_worktree` ran in the same minutes.

**Do:** give the pass a span; cut the cost to what changed (compare against the already rendered tree instead of re-reading every file); move whatever stays heavy — tree rendering and writing — to the owner's worker or async I/O so the loop never stalls.

**Done when:** projecting the runlith graph (thousands of blocks) produces no loop stalls on `tagma:try`, and its span is visible in `read_performance`.
