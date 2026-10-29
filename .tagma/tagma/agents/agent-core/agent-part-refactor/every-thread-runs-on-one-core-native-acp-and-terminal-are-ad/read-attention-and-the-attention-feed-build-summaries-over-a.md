---
id: 01a11da1-aefb-7e1f-b9c7-cbe774fb1ec4
title: read_attention and the attention feed build summaries over all live threads of the owner without pagination
ord: 19
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11ca5-7ddf-7f42-a891-bd67d38667ed
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/store.ts
---
`attention()` (`apps/tagma/server/src/threads/list/store.ts`) selects candidates with the SQL `attentionCandidate` condition before building summaries, so the said-line subqueries over `threadEntry` run only for threads that need the operator. Measured by plan (`lifeReads.itest`): no scan over all owner threads — the plan starts with a `thread` lookup by `id` from the candidate list and contains scans of only two partial indexes (`thread_run_tally_unseen_idx`, `native_thread_asking_idx`); the rest are index probes (`thread_run_active_unique`, `native_thread` by key, `thread_seen`), the SQL call count does not grow with the thread count, and `thread_entry_run_idx` appears only in the result-row subqueries.

The query leads with the candidate set, not the owner's threads: `recordFacts.id in (…)` over three sources, each read by its own index — `thread_run_tally_unseen_idx` (partial: threads whose last ending is still unmarked; `EndedRuns.tally` sets `unseen` on every run end and `ThreadListReads.see` clears it), `thread_run_heartbeat_idx` (running runs awaiting an answer), and `native_thread_asking_idx` (partial: question slot with an act). The exact `attentionCandidate` condition checks the selected rows. The owner condition is written as `+principal_id` so the planner does not bypass the owner index for the candidates.

Proof: `lifeReads.itest` — the `attention` plan starts with a `thread` lookup by `id` from the candidate list, contains scans of only two partial indexes and no `thread_name_unique`; the call count does not grow with the thread count. `attention.itest` — an ending leaves the list once marked "seen", and a new run end brings the thread back.
