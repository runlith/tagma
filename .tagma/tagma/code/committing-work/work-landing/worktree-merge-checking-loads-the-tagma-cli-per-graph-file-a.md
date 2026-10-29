---
id: 01a13618-8c31-7e1f-b2fe-6db10d2fb993
title: "Worktree merge checking loads the Tagma CLI per graph file and duplicates itself: 2–2.5 cores for minutes on every main movement"
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1362d-91c9-7219-b18f-62c9ecf0d886",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13616-a718-7223-86c3-78cd69b7211d
sources:
  - kind: dir
    ref: apps/tagma/server/src/landing
  - kind: file
    ref: packages/git/src/merge.ts
---
Worktree merge checking (`check_worktree_merge` and the `check`/`conflicts` status in the worktree listing) eats 2–2.5 machine cores for minutes. Sample 2026-10-13 16:28 UTC: the server held four `git merge-tree --write-tree` — two identical per worktree `optional-fields` and `tagma-holder-impl-f0e304`, each running over 1.5 minutes. `merge-tree` calls the `tagma-graph` merge driver (`.git/tagma/merge-driver` → `bun main.js merge-driver`) on every `.tagma/**` file changed by both sides, i.e. boots a full CLI per such file: processes ran four at a time, each at 50–66% of a core for about a second. A branch long behind main diverges from it in dozens of graph files, and the check repeats on every main movement, i.e. every few minutes while agents commit. In Load it shows as "Tagma 44.5%".

The check also litters the worktree: an interrupted `merge-tree` leaves git's temporary `.merge_file_*` files in the checkout root. `optional-fields` holds 66 of them, dated 11–13 October; `tagma-holder-impl-f0e304` — about 60. Because of them the worktree counts as dirty (`uncommitted: 57/60`), and archiving `optional-fields` on 11 October committed these files into the branch as "the work left uncommitted when the worktree was archived" (`3663804081`).

An interrupted check restarts at once. On 13 October its processes were killed several times in a row: within fractions of a second a new `merge-tree` already ran in the folder and wrote `.merge_file_*` again. Because of this `delete_worktree` refused five times on `optional-fields`. The operator demands: a worktree nobody works in costs nothing.

Do:
- a worktree with no working or waiting threads is not rechecked on main movement; its check is taken when it is looked at, when its branch moves, or when a merge is requested;
- a deleted worktree's check stops and never starts again;
- the check does not boot a process per graph file: its cost grows with the number of diverging files within one process, not with the number of CLI boots;
- one check per tip pair: identical checks running at once merge into one;
- the check leaves no files in the checkout on any outcome, including interruption; its temporary files live outside the work tree.

Start at `apps/tagma/server/src/landing` (where checks register), `packages/git/src/merge.ts`, and the `merge-driver` CLI command. Reread the [[9543a701|landing module]]'s decisions on checking before changing.

Proof: on a branch where N graph files diverge from main, one check performs one boot for the whole check, not N, and yields the same clean/conflicts answer as before; two concurrent checks of one tip pair launch one `merge-tree`. Plus CPU cost of one check before and after on a truly lagging worktree.
