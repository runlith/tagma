---
id: 01a1321c-2265-787f-bcd0-daa6156f2211
title: "A shared .git watcher marks any rename at its root as a config change: full worktree status rereads and ~12 git processes a second"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1321c-625d-7dd4-9e15-215c3aba4bb1",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/watch/tree.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
---
Checkout status reads (`CheckoutStatus.reading`) run ~1.3 times a second (3703 over 48 minutes on 12.10, ~21:00–21:48), each a full `git status --untracked=all` plus two `numstat`s, 351 ms on average, slow ones up to 2 s; total git processes ~12–13 a second. Some slow reads are marked `checkout.reason: config`.

Suspect in `watchTree` code (`platform/watch/tree.ts`): for a worktree whose `commonDir` lies outside the tree, the watcher over `commonDir` (non-recursive) reports `movement: 'config'` on ANY event with `rescan`. On macOS `fs.watch` yields `rename` for most writes, and `watchEventOf` turns a `rename` with a file name into `{ rescan: 'rename', paths }`. So every atomic write at the shared `.git` root — `index.lock`→`index` of the main checkout, `ORIG_HEAD`, `FETCH_HEAD`, `packed-refs` — marks "config" on every open worktree and starts a full reread. The `info/` watcher (`ignore`) shows the same pattern. The tree branch (`places.tree`) already distinguishes a named rename from a nameless one.

To do: verify the hypothesis (how many reads with reason `config`/`ignore` are caused by files that are not `config`/`exclude`), and if it holds — the `commonDir` and `info/` watchers react to a named rescan only for their own file, while a nameless rescan stays full. Then look at what else wakes main-checkout reads with reason `index` that often: whether Tagma itself writes its index (its own git commands without `--no-optional-locks`, temporary indexes), and remove the self-excitation if there is one.

Verified red/green: named events from unrelated files in the shared git directory produce no `config`/`ignore`; atomic metadata replacements are still observed; a clean team-graph read changes neither index inode nor mtime. In the in-process `feed.bench.ts` (3 worktrees, one external and main, 9 unrelated atomic writes over 10 s) new `CheckoutStatus.reading` fell from 40 to 0, `Git.spawn` from 231 to 8; the remainder is a startup tail, the feed agrees with the same owner's list. `rows.itest.ts` is sped up with a shared Git seed and runtime: 20 tests pass without the old warning of 16,213 ms CPU against an 8,000 limit. One review round by Sol and three Muse lenses done, confirmed remarks fixed. Its own `tagma:try` was built, `/health` and `read_performance` checked, then it was stopped; a paired workload on the built before/after is not proven because the first build was blocked by someone else's missing imports. The running server was untouched. The pre-existing `HeadWatches` recovery gap is moved out into [[27a3d0b1|the watch-recovery task]].
