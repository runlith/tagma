---
id: 01a15122-5336-7088-b725-b4f063ea1699
title: Move growing reads to keyed store pages and introduce a typed cursor selection
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15122-6a81-7159-9f97-466209423a9c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15122-36a1-7576-9a31-af8d655a7040
sources:
  - kind: file
    ref: packages/paging/src/pages.ts
---
Implement [[655a7040]] in full: classify the `pastKey` reads, move the growing ones to keyset pages at their store after the `Selection.queryPage` model, introduce the selection schema in `PageQuestion` and the shared page path in `@runlith/paging`, remove `cursorSelection`. Start with `packages/paging/src/pages.ts`, `graph/search/selection.ts` (`queryPage`, `ready`) and `graph/operations/work.ts`. Proof is the spec's acceptance criteria; the read classification is named in the finish.

## Read classification

Growing — a store page by key, `limit + 1` rows, details only for them:
- `ready_work` — `Selection.readyPage`; `read_amendments` — `Review.proposalsPage` over `Selection.rowsPage`; `query_blocks` — `Selection.queryPage` over the shared `keyedRows`;
- `read_reflections` — `Reflections.standing`: the standing record, sightings and total in SQL;
- `read_gauges` — `Sources.atPlacePage`: the area is found over the page rows' ancestors, not over the whole project tree;
- already at the store and now going the kit's shared path: `read_events`, `read_terminals`, `search_blocks`; the `read_changes` turns and the sleeping `list_threads` threads already paged at the store.

Bounded — stay in memory (`pastKey`/`heldRows`), and why:
- `read_calls` — live calls and endings not yet delivered to the thread; delivery removes them, this is not accumulated history;
- `read_attention` — the live projection of `ThreadList` with threads awaiting the operator; the record leaves on read;
- `list_worktrees`, `list_worktree_cleanup` — the project's live worktrees; the order derives from git state, so there is no key to read by;
- path holdings in `read_changes` — the Holdings court over the checkout's uncommitted paths; debts are now read only for the page rows;
- `list_threads` — an explicit `ids` list and running runs, their count bounded by parallel runs;
- rules (`read_command_rules`), enforcement engines and document lists (debt, escaped, units, entries), built-in inspections, violations of one `check_law` run, plugins, plugin secrets, compaction options, the operation catalog — size set by configuration, code or one run;
- `ls`, `glob` — filesystem walks: the directory reads whole, and mtime order needs every file.

Open: `read_amendments` conflicts on every page — [[97350575]].
