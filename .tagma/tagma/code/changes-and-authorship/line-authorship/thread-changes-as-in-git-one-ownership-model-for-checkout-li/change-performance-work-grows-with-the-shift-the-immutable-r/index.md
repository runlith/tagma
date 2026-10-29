---
id: 01a1166f-7113-7752-b6b9-0a78f16c4571
title: "Change performance: work grows with the shift, the immutable reads once, git runs in one session, budgets are checked on a fixture"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/walks.ts
  - kind: file
    ref: packages/git/src/working.ts
---
The operator's condition: the machinery is fast, on the best algorithms, not slapped together. This part is the requirements on [[1509a7f0]]–[[762eb07f]] and the budgets they are accepted on. Work grows with what moved, not with everything that exists (2393aff1). The immutable is read once. The event loop never computes (7a910861).

## Measurement

One sample: this machine, the server, 2026-10-07; runlith — 24,366 tracked files, 197,557 project record lines.

- **Spawning git is the main cost.**
  - `Git.spawn` — 367,047 per hour on October 7 at 02:00 UTC versus 3,606 per hour on October 6 at 11:00 UTC (before 5c6c3f62c4).
  - Cause: tar past 256 KB with no worker. `packages/git/src/working.ts` `archivedAt` falls to `cat-file --filters` one process per file, and then `textsOfFiles` pours the whole batch anyway. `Git.workingArchivedAll` for that hour is 2,012 s, p99 to 32 s.
  - Over the last 70 min — 14,214 spawns, 402 s.
- **Sidebar.**
  - Recalculation after an edit (`heldPathsMoved`) — up to 731 s per hour, single calls 16–32 s. In `b43d2ac260d4f0de` only 44 ms of 30,127 ms is covered by spans. The rest is waiting on the global `Semaphore(1)`, the walk-worker queue, and stat without spans.
  - Cold full count (`heldPathCountsOf`) — 4 calls of 32–65 s each.
  - By code: 3–4 full Myers passes over the whole file per record line plus loading every version of the path.
- **Panel.** On any root fs event — a full `readList` over every thread path for every open panel. `ThreadFiles.commits` — up to 3,100 per hour; `Git.commitOf` — 1–3.8k per hour.
- **Checkout line.**
  - `CheckoutStatus.reading` — 644 in 70 min, p50 256 ms, p99 4 s, 255 s total. On each read — `holdersOfRoot` over every dirty path: 697 × p50 32 ms.
  - The path-limited path (`workspace/checkouts/comparison.ts` `readTree` with `paths`) already exists. Why the full status is still frequent is what building [[fe04fc30]] finds out, not this spec.
- **SQLite.**
  - A place is addressed by an OR of three keys.
  - `checkoutsWhere` in `heldCounts.ts` joins on string concatenation.
  - `writtenOfThread` goes on `workspace_change_path_idx(project_id)` and scans 197k lines: p50 256 ms.
- **Store.** 21,944 held lines outside any checkout (1,802 threads) hold 401 MB of versions and 435 MB of inline hunks.
- **Caps are constants, not a machine budget:** `KEPT_VERDICTS` 4096, `KEPT_THREADS` 1024, `KEPT_MOVES` 64, `COMMITS_KEPT`, `UNATTRIBUTED_KEPT` 256 (fe83acfa).

## Requirements

1. **A shift → only its paths.**
   - A line write → its path.
   - An fs event → its paths.
   - A HEAD shift → `diff-tree old new` ∩ domain.
   - An index shift or watcher loss → fingerprint domain; only what changed is walked.

   No single-point event leads to a full re-read (I15).
2. **Single-flight per path** instead of a global semaphore. One judgement on `(checkout, path)` for every thread and surface. The requesting path goes ahead of the background.
3. **Incremental folding** ([[359519e0]]).
   - A step with `before` = front — O(log runs + hunk) on the hunk's exact span.
   - Myers only on a break and only between diverged anchors, with a work budget.
   - A HEAD shift is one base-to-base alignment per path, cached on the oid pair. The folding never recomputes on it.
   - Versions read from storage only for lines past the cached front.
   - Folding state sits in the server process LRU, bounded by bytes.
4. **The immutable by its own id.**
   - A blob text by oid and filter flag. Commit metadata by sha. Reachability by `(sha, HEAD)`.
   - Caches bounded by bytes (texts) or a count derived from machine memory.
   - Re-reading the immutable is forbidden.
5. **Git as a session batch reader per repository.**
   - The `--batch --filters` variant does not work (verified by probe on git 2.50.1, upstream master the same). The header carries the source blob's size while the body is filtered bytes, so the stream cannot be split. Besides, input `<rev>:<path> <path>` splits on spaces, and a long-lived process caches index, `.gitattributes`, and config.
   - **Accepted protocol.**
     - **Paths to oids.**
       - For a revision — tree objects read by the same raw session: the root tree from the commit, then descent on the requested paths' trie. Every tree object caches by oid. Mode comes from the tree record, so symlinks and gitlinks tell apart. No processes go to this, and warm — no reads either.
       - For staged — a fresh `ls-files` in argv batches: the index has no immutable key.
       - Spaces and tabs in paths survive.
     - **Raw texts.** A long-lived `git cat-file --batch` without filters reads them by oid. The header size is exact. Objects written after the session started, packed ones included, read — verified by probe.
     - **Whether conversion is needed.** Decided by one batched attribute pass: a fresh `check-attr --stdin -z` (`text`, `eol`, `filter`, `working-tree-encoding`, `ident`) plus `core.autocrlf`.
     - **Paths without conversion** serve raw bytes — that is their working form. Mode `120000` is always raw.
     - **Paths with conversion** read per object: `cat-file --filters --path=<p> <oid>`.
   - Pass cost is O(1 + k) git processes, where k is conversion paths.
   - This is a new `@runlith/git` contract: the `Git.objects` ability gives a session per (repository, live environment) pair and restarts it after failure. Its road is the one today's stdin git calls take: the platform `servingGit` branch (`packages/agent-tools/src/runtimeSpawner.ts`, server process). The execution host never runs it: it has no managed stdin execution, and `admittedGit` refuses stdin.
   - A probe at startup verifies the chosen raw protocol; when unsupported, reading goes per object.
   - The session replaces `git archive` + tar + unpack worker + per-path `cat-file`, and `packages/git/src/unpack.ts` and `unpack.worker.ts` are deleted.
   - `ls-tree` and `diff-tree` go in batches. "Path → range commits" is one `git log --format=%H --name-only`.
   - Judging K revision paths costs O(1 + k) git processes, where k is conversion paths (I15). Staged reads cost O(argv batches + k).
   - The text cache is one, in the `@runlith/git` kit, not in consumers. Raw texts land keyed by (object store, oid) with a byte limit derived from machine memory. Session and `ls-tree` run with `GIT_NO_REPLACE_OBJECTS=1`: only then is oid truly immutable, and Tagma never sees replace objects. Filtered ones never cache until their key includes the full filter witness (path, attributes, config): one oid yields different bytes under different filters.
6. **One stat→digest cache per checkout** for the judge, the checkout line, and command base digests (three now). A digest counts only on a changed stat or a ctime under 2 s; for large files — by a worker stream.
7. **SQLite.**
   - A record line's key is `(checkout, path)` ([[b17adfeb]]). Partial index `(checkout, path) where held` and a `(thread, path)` index for thread questions, `written` included.
   - Thread statuses in one distinct-id query, not a subquery per line.
   - No joins on concatenation.
   - Answer-path and judgement queries go on index only: a test on `EXPLAIN QUERY PLAN` of those queries, not one `SCAN workspace_change`. The collector and migrations stay outside that test.
8. **Loop and worker.**
   - On the loop — orchestration, indexed SQL, stat, small-file digests, hunk-bounded folding steps.
   - In the worker — break Myers, base alignments, large-file digests.
   - Version texts from the store process (`sqlite-process`) never parse on the loop: large texts go to the worker as buffers, with no per-line work on the loop.
9. **Compressed changes to the client** ([[762eb07f]]). Thread totals are kept by counters on `hands` change, not by recount.
10. **Store holds only the live.** No lines outside checkouts: the [[b17adfeb]] migration deletes today's, and intake writes no new ones. Texts of withdrawn and committed lines are freed by the collector (`c851d6c3`).
11. **Observability.** Separate spans on:
    - single-flight waits;
    - the worker queue and worker work, separately;
    - path judgement — with attributes: record lines, bytes, folding- and blob-cache hit or miss;
    - the git-reader session;
    - intake — intent, file write, confirmation.

    30 uncovered seconds must never be a mystery again.
12. **Cold start.** First the checkouts of threads visible in the list, without blocking answers ([[fe04fc30]]).

## Budgets

These are goals. The owner's performance test on a fixture that models a machine range accepts them, not this one (fe83acfa): 20,000 tracked files, 5,000 paths under 10 threads' record lines, 1,000 paths of one thread. The result is reported as a sample with the machine.

- **Intake.** A typed edit on a free store adds at most 20 ms p99 to the tool (intent + confirmation).
- **One path edit** → a change in `thread.changes` and `holdings.subscribe` no later than 100 ms past that path's walk. On warm blob caches — zero HEAD text reads.
- **Opening a thread panel** with 1,000 paths from a built Holdings — first frame no later than 200 ms.
- **A HEAD shift** over 50 commits touching 200 held paths: transitions run in O(1) git processes per batch and no later than 2 s past the walks.
- **Cold build** for 5,000 paths:
  - loop-delay p99 under 50 ms for the whole build;
  - the first frame of visible threads arrives before the build ends;
  - the wall is bounded by worker work, and its value is reported in the measurement.
- **Memory.** Folding states and the blob cache fit the machine-memory share the owner's budget sets. The test checks the ceiling on the fixture.
- **Git processes per judge cycle** never depend on the cycle's path count.

## Acceptance

- The budget test above: system layer, no longer than 60 s (99b9fa72).
- Integration: one path edited out of 1,000 held rejudges exactly one path. The answer's revision and change contents show it, plus the judgement-span counter — not a private helper.
- `EXPLAIN QUERY PLAN` of the answer-path and judgement queries is SEARCH only.
- After the [[b17adfeb]] migration there are no held lines outside checkouts, and `workspace_change_content` shrank by the volume only they held.
