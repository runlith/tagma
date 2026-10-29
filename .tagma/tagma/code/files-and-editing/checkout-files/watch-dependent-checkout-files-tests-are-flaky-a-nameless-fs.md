---
id: 01a13c59-b942-7b07-a46d-8a4ff033c530
title: "Watch-dependent checkout-files tests are flaky: a nameless fs.watch event produces an `unnamed` rescan and refreshes all cells"
ord: 10
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13c32-08e1-7d7c-be3b-b3f25eff2d76
---
Found while migrating the checkout-files module to Effect style ([[5eff2d76|checkout-files migration task]]); the migration did not change watch and dispatch behaviour.

**Exact tests** (all in `apps/tagma/server/src/checkout-files/`):
- `documents/open.itest.ts`: "an event on one path refreshes that path alone among many open documents" — asserts that after writing d7.txt only that cell received stat.
- `finding/indexes.itest.ts`: "files created after the index stands are added by one listing of those paths, not a rebuild" — counts full `git ls-files` by spawns.
- `listing/directory.itest.ts`: "creating a file in a directory sends one tree frame naming that directory alone" — waits for exactly `dirs: ['src']`.

The same family outside the module: `apps/tagma/server/src/platform/watch/tree.itest.ts`, when migrating the platform tests (55db6456de), started repeating the write until an event arrives — under load it lost the first event. The retry weakened the check: a watcher that missed an event now passes. This task's fix returns the test to a single write.

**Frequency.** Running the whole module with `bun test --parallel=3`: sometimes 25/25, sometimes 2–4 failures of these three. Alone, the files are green almost always. A scenario probe (30 open documents, writing one): in 2 of 3 runs after the write all 30 cells received stat instead of one; the tree feed shows a dirs frame with an extra `""`.

**Hypothesis.** `fs.watch` on macOS under load emits events without a file name; `apps/tagma/server/src/platform/watch/tree.ts:44` turns such an event into `{ rescan: 'unnamed' }`, and `documents/open.ts` (dispatch) on any `shift.rescan !== null` refreshes all checkout cells — this is the declared rescan behaviour, but the test asserts exclusivity the watcher does not promise: a "one path changed" event and a rescan are distinguishable only by shift shape, and the window between the write and the change frame is open to a nameless event. Same family — extra dirs frames and index rebuilds in the two other tests.

**For the owner to decide.** Don't break the `unnamed → rescan → refresh all` semantics (it guards against missed events). Options: tests wait for the event deterministically (e.g. a test world with a controlled watcher for exclusivity contracts with live integration coverage separately), or dispatch for a `rename` rescan with named paths updates only them. Proof — these three tests stably green in a full parallel module run, repeated several times.
