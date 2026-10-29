---
id: 01a102b1-c4d6-7d0d-a7fc-c83c363b3e55
title: The held-file counter and the thread's file weights follow the per-path verdict, and line walks run in a worker
ord: 1
---
The held-file counter and the thread's file weights follow the per-path verdict, and line walks run in a worker.

The "files the thread wrote and nobody committed" counter in the sidebar and the thread's file list are not recomputed on every event from the per-path stored verdict. Only a path whose input moved is re-judged.

**A path's verdict and its inputs.** `HeldCounts` (`record/heldCounts.ts`) keeps, per held path keyed by project + checkout + path, who holds its lines. The verdict stands until three inputs move:
- the path's held lines: each line's id, whether it is bound to a checkout, and whether the texts of its versions are stored (`heldRowsAt`, `record/inputs.ts`);
- the path's blob in HEAD (`git ls-tree`);
- the working file: [[570a4bee|the file provider's shared input]] — device, inode, mode, size, mtime and ctime.

Stat is only trusted when ctime is older than 2 s. A fresher file is checked by content sha, so a file being written right now is not walked again when its bytes did not change.

The thread's file list (`threadFiles/listing.ts`) stores each path's weight at the same time. Inputs: the path's lines, the blob in HEAD, and stat. A path in the index (staged) is not cached.

**Re-judging after an edit touches only the moved places.** Intake (`record/intake.ts`) and command lines (`record/commandRows.ts`) publish the places they moved (`HeldMove`) to `HeldFeed`. `HeldCounts` keeps a "thread → its held paths" index and accumulates moved places per thread. `moved` only re-judges those and refreshes the index for every indexed holder of those places. `counts` checks each of the thread's paths and rebuilds its index. A change without places (a commit, a call through a door) or a thread without an index leads to a full count. An external edit of an unmarked path is only visible at a full count: when a window opens and when an untracked project is read.

**Walking runs in a worker pool.** `Walks` (`lines/walks.ts`) runs in `walk.worker.ts`, not on the server event loop, all work whose cost grows with file size and history:
- provenance walks (`holdersOf`) and every fold step, including the hunk step;
- panel weights (`weighPath`, line counting) and per-line diff authorship (`authored`);
- `submit_work` landing (`landingOf`, `carriedLines`), including preparing the sides of a cutting path (`file`), and line rollback (`revertOf`);
- command-transition hunks (`hunks`, the `later` band);
- preparing Holdings judge inputs (`holdings/inputs.ts`): decoding, digesting and splitting the HEAD and working-file bytes into lines (`file`), and version texts (`content`).

Version texts are prepared once per digest per build, and only for lines past the fold's cached prefix. A version whose digest matches the working file takes its Content, and the digest key of the store is not recomputed. The preparation band is the same as the judge batch's. The pool size derives from the machine: a quarter of the cores, from 1 to 4. The queue stands on the server side, one request per worker, in two bands: the requesting path's requests (`now`) go before background tallies (`later`), and a request whose waiter is gone is dropped from the queue before reaching a worker. A request past 30 s of wall time fails its worker and drops `WalkUnfinished`. `submit_work`, `check_rules` and `revert_lines` answer it with a `walk-cut` refusal; line attribution in a rule check fails the inspection with reason `deadline`; the counter gives a conservative answer. The worker enters the release as a separate point `bin/server/walk.worker.ts`.

**Budget and an honest answer.** Walking is bounded by work: `stepsIn` debits every diagonal and every Myers-snake step, including the final round. When the walk does not fit the budget or the worker does not answer, every session with outstanding lines on the path is named as holders, with `unknown: true`. That is not a refusal: the counter and the record guard receive a conservative answer.

**The list does not wait for the counter and does not fail with it.** The `threads.subscribe` subscription delivers the window with the counters already known and tallies the rest in the background, sending lines whose counter changed. `markHeld` queues the writing thread's recount (`moved`) with coalescing and never delays the writer. `list`, `row` and the following windows of a tracked project also answer with known counters and tally unknown ones in the background; a project with no subscriber is counted on read, because no one maintains its counters. An unreadable checkout does not count paths, and a too-large or unreadable file counts as written by everyone.
