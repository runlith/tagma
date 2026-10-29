---
id: 01a0daf8-908a-729a-b84d-20b7003572d1
title: The archived worktree set is read again only when a worktree joins or leaves the listing, never when a row only moves
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/worktrees/Finishing.svelte.ts
    symbol: Finishing
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/worktrees/Worktrees.svelte.ts
    symbol: Worktrees
---
## 1 Outcome
A tab showing the archived worktrees (the board's fold or the Agents column's) asks `GET /api/archived-worktrees` when it first shows them, after a finishing act, and when a worktree joins or leaves the live listing — and at no other time. A row that only moves (its uncommitted count, status, agents, last movement) or a reordered list asks nothing.

## 2 Problem and evidence
`~/.tagma/serve.log`, the server that booted 2026-09-25 23:18:23Z, over its first 16 minutes: 963 `GET /api/archived-worktrees` (≈ 1 a second) while nobody archived anything; the instance before it answered 3,504 in 1 h 45 min. Each is cheap on the server (`list_archived_worktrees` 445 calls, 0.5 s in 7 min), so the cost is the request itself — admission, the HTTP span, the loop turn — paid once a second per tab.

Cause: `Finishing`'s constructor effect reads `this.worktrees.rows.map(...).join('\n')` to follow membership, but the effect tracks the `rows` signal itself, and `Worktrees.take` replaces `rows` on every row frame. The worktree feed sends a row frame whenever any row moves — main's uncommitted count moves with every write in the checkout — so the effect re-ran, and re-read the archived set, on each one. Reproduced: `Finishing.svelte.test.ts` sends five row frames and one reordered list over a shown fold and counts 6 extra reads where 0 were meant.

## 3 What holds now
Claim cc3422a4 already states the intended contract (read again "after a finishing act or a change of the listing's membership"); the code breaks it. `WorktreeSwitcher.svelte` already follows its own slice of the rows through a `$derived` string (`checkedOut`), which is the pattern that works.

## 4 Target model
`Worktrees` owns the listing's copy, so it owns what its membership is: a `$derived` string of the listed root ids, sorted, so neither a row's movement nor the listing's order changes it. `Finishing`'s effect reads that value; a derived string notifies its readers only when it changes.

## 5 Owners and boundaries
`apps/tagma/app/src/lib/features/worktrees/Worktrees.svelte.ts` (`membership`) and `Finishing.svelte.ts` (the effect). No server or protocol change.

## 6 Rejected
- Debouncing or throttling the archived read: pays fewer requests for the same wrong dependency, and the operator forbade it.
- Having the server send an "archived moved" frame: the listing membership already says it for every act the surface reacts to; a new frame kind would be a second answer to one question.

## 7 Acceptance
- `Finishing.svelte.test.ts`: over a shown archived set, five row frames and a reordered list read nothing; a list frame without one of the rows reads once.
- Measured on a deployed build: `GET /api/archived-worktrees` in `serve.log` falls from ≈ 1 a second to the handful a finishing act or a membership change asks.

## 8 Claims and tasks
cc3422a4 stays true and gains the reason and a source on `Worktrees#Worktrees`'s membership; no task.

## 9 Order
The test first (red on the current code), then `membership`, then the effect.

## 10–17
- 10 Contract: out — no wire change.
- 11 Stored data: out — nothing stored.
- 12 Who may do what: out — no act changes hands.
- 13 Long-lived things: the effect keeps its `$effect.root` under the `Finishing` scope as today.
- 14 Bounded resources: the request rate is the resource; bounded by membership moves.
- 15 Rollout: takes effect when a tab loads the new bundle; an old tab keeps asking until it reloads.
- 16 Failures: a dropped socket replays a list frame; if membership moved meanwhile it reads once, otherwise nothing.
- 17 Observability: `serve.log` counts of the route, and `list_archived_worktrees` in `read_performance` overview.
