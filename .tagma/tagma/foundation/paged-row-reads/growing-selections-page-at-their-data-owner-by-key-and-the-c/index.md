---
id: 01a15122-36a1-7576-9a31-af8d655a7040
title: Growing selections page at their data owner by key, and the cursor selection is typed with one schema
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/paging/src
  - kind: file
    ref: apps/tagma/server/src/graph/operations/work.ts
---
## What stands now

Paged reads (`@runlith/paging`) answer a page, a total and a cursor, but most operations build the page the same expensive way: the owner hands over the **whole** selection, the operation sorts it, `pastKey` filters out rows up to the cursor, `page` cuts `limit`. About twenty reads work this way — `ready_work`, `read_amendments`, `read_reflections`, `read_calls`, `list_threads` (`packages/agent/src/collaboration/native/threads.ts`), `read_changes`, `read_gauges`, the worktree lists, `attention`, the enforcement reads, plugins and others (`pastKey` calls outside `packages/paging`). Every next page re-reads and re-filters everything. `ready_work` (`Selection.ready`) additionally assembles details — bodies and fields — for every ready task of the project, though the page shows dozens.

The right path already exists: `Selection.queryPage` (`graph/search/selection.ts`) asks SQLite for `limit + 1` rows on a keyset condition past the cursor key, plus a separate `count(*)`, and assembles details only for the page rows.

The second repetition is restoring the selection from the cursor. The cursor carries the first question's selection, but `cursorSelection` returns `Record<string, unknown>`, and every operation checks the fields itself with `typeof` or casts (`work.ts:91`, `:145` — `as string | undefined`; `blocks.ts` `search_blocks` — eight `typeof recovered?.x === …`; `orientation.ts:168`; `blocks.ts:76`). In `ready_work` and `read_amendments` the block "restore scope → build `PageQuestion` → `readCursor` → `pastKey` → `page`" repeats almost verbatim.

## What will stand

1. **Growing selections page at their data owner.** A read whose selection grows with the product with no upper bound — blocks, events, reflections, calls, threads, change-record rows, gauges, worktrees — takes its page from its store: a keyset condition past the cursor key, `limit + 1`, a separate total count, details only for the page rows. The key order stays the one the operation uses now, so cursors and answers don't change for the caller.
2. **Selections bounded by construction stay in memory.** Enforcement engines, rules, plugins, plugin secrets, command rules, compaction options — sets whose size is set by configuration, not by accumulated work; for them the `pastKey` + `page` path is right and simpler. Assigning each read to one of the two classes is part of the work and is named in the task.
3. **The cursor selection is typed.** The walk (`PageWalk`: operation, selection schema and key schema) declares its selection schema, and `PageQuestion` is built from it; one `@runlith/paging` function restores the selection from the cursor, validating it against the schema (`cursor-stale`/`bad-cursor` as now), and operations stop checking fields one by one. The key schema hands the store a typed position: an unreadable key is `bad-cursor`. `cursorSelection` with `Record<string, unknown>` goes away in the same change.
4. **One page path per operation.** The repetition "entry or cursor → question → cursor read → page" becomes one kit function, which the operation hands its selection schema, order and store page read; the operation only writes its own part: what to select and how to answer.

## Owners and boundaries

- `packages/paging` — the question type with selection schema, selection restore, the shared page path. The kit knows no SQL: the data owner's store builds the keyset condition.
- The owner stores (`graph/search/selection.ts`, `graph/work`, `reflections`, `native-harness`, `change-record`, `worktrees`, the `packages/agent` thread list) — page reads by key after the `queryPage` model.
- Operations — only the declaration of selection, order and answer.

## Why this way

- A page's cost must depend on page size, not on the accumulated graph (rule 2393aff1: no recomputing the unchanged and no full re-reads for one change; cost is removed at the producer).
- The cursor selection type is the boundary of caller-supplied data; one schema check instead of scattered `typeof`s and casts.
- Bounded sets don't move to SQL: that would add code with no gain.

## Acceptance criteria

- Every read from the `pastKey`-call list is assigned to growing or bounded, with a reason for the bounded ones.
- Growing reads take no more than `limit + 1` rows per page from their store and assemble details only for them; the owner's SQL shows it.
- Operation answers and cursors are unchanged for the caller: same fields, same order, same `cursor-stale` refusal on someone else's cursor.
- Server code has no `cursorSelection` and no cursor-selection casts; `ready_work` and `read_amendments` don't repeat the page path.
- `bun run typecheck` and the affected modules' tests are green.
