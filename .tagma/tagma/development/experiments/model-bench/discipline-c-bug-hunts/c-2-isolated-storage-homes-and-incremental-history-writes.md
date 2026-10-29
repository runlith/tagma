---
id: 01a0c4f7-9229-70ca-9fa4-0539bc709665
title: "C-2: isolated storage homes and incremental history writes"
ord: 2
---
C-2 contains two assigned fixes on one frozen current-code snapshot, separate from the historical C-1 worker.

- **C-2a.** `435b04e5` makes plain-tree storage local to the database's own home, rather than a shared sibling path. Fixtures must remain hermetic when suites run concurrently.
- **C-2b.** `07eba717` makes history writes proportional to the new material rather than reserializing the whole conversation. Reader-visible history and recovery semantics must remain unchanged.
- **Source.** The prepared attempt used `ec5f3b70ba7e7d8ec96f73e07f4ccc90d419a27e`; a later launch either retains it or explicitly records a newly selected snapshot before all workers start.
- **Oracles.** Acceptance criteria are frozen before the first worker receives its assignment; backend-specific baselines are measured during preparation. The two fixes are judged separately even when one worker performs both.
- **Boundary.** This tree contains later commit-door code and must never become input to the C-1 worker. Allocation is [[c12b7eb7]], still awaiting confirmation.