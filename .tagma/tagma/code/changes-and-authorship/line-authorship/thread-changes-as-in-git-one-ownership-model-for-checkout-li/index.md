---
id: 01a1166f-7113-7752-b6b9-0a71c16f87cd
title: "Thread changes as in git: one ownership model for checkout lines, one attribution algorithm, one way in and out — and fast"
ord: 12
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/change-record
---
For every thread, the operator and agents must see what git shows for a repository, but scoped to one thread:
- what the thread changed and has not committed;
- what it committed;
- what it did turn by turn;
- what became of its lines.

And see it identically on every surface. That is not the case now, and the cause is not a set of isolated bugs but the design itself:
- six algorithms in nine consumers answer "who holds the line";
- lines enter through five doors and leave through seven;
- every consumer turns a read failure into its own "nothing".

This spec replaces that with a single owner: one model, one attribution algorithm, one way in and one way out.

## What the operator gets

**A thread — like git.**
- *Uncommitted:* files where the thread holds lines. For each, its own +/- rather than the whole file diff, the git letter, and who else holds lines in that file.
- *Could not verify:* files with a reason. They do not disappear from the list.
- *Commits:* commits that carry its lines and are reachable from HEAD.
- *How the lines ended:* totals by reason (overwritten, reverted, left uncommitted); details live in `read_changes`.
- *By turns:* which files each turn touched and what of that still stands (`read_changes`, `read_rewind`, line rollback).

**Checkout.** Every changed path has exactly one state:
- proven — which threads hold lines, plus nobody's lines where there are any, with a reason;
- unproven — with a reason.

**One number per question.** The sidebar badge, the Changes panel button and contents, the status-bar totals, the Git tab, `read_changes`, `read_checkout`, `read_authorship` and `submit_work`, and the rules judge all take their answer from one model at one revision. They cannot diverge by construction.

**Fast.** Editing one file costs work on one file, and immutable data is read once ([[f16c4571]]).

## What stands now (read in code and measured 2026-10-07 on runlith)

- **Symptom.** A thread held lines in 30 files. The sidebar showed "30", the panel showed "No changes yet", the status bar showed "45 changes".
  - The panel was empty because the install lacks `packages/git/src/unpack.worker.ts`: the install was built from a hand-written worker list that omitted it (the list was replaced with bundler output in f40590b15b, but the running install predates it). So every text batch over 256 KB reads as `GitUnreadable` in full. `threadFiles/weigh.ts` lets that failure through to the top, `threadFiles/listing.ts` `readList` fails wholesale, and `threadFiles/rows.ts` `settle` silently sets `files: [], stale: true`. The client does not read `stale`.
  - The sidebar (`record/heldCounts.ts`) answers the same failure with "everyone who ever wrote holds".
  - 15 of 45 paths are nobody's. The `oxfmt` commit step rewrote commit 7617026687, and `reshape` answered the same failure with `kept: unreadable`. The lines had already been stamped with the landing plan by then.
- **Six attribution algorithms:**
  - Myers marks `lines/frontier.ts` `holdersOf` — sidebar;
  - textual replay `lines/attribution.ts` `weighPath`/`landingOf` — panel and landing;
  - `carriedLines`/`writtenLines` — `read_authorship` and violation attribution in `prepared/subject.ts`;
  - `lines/revert.ts` `revertOf` — line rollback and `read_rewind`;
  - `record/discharge.ts` `dischargedIds` heuristics on `windowMatches` — line exit on HEAD shift;
  - "there is a record line, so it holds" (`record/holding.ts`, `record/evidence.ts` `writersOfPlaces`) — checkout line, rules judge, worktree archive.

  So one commit can land as own under one algorithm while another attributes its violation lines elsewhere.
- **Failure turned into data.**
  - An unreadable HEAD blob counts as "file absent in HEAD" (`discharge.ts` `blobsAtRevision`). As a result, a held deletion line is simultaneously withdrawn by `withdrawGone` and stamped `reached`.
  - `standingAt` reduces any failure to the empty set.
  - `prepared/subject.ts` `textOf` reduces an unreadable side to "no file".
  - A defect inside `settle` leaves `reading = true` in `platform/rereading.ts` forever, and rereading never starts again.
- **Five ways in, each behaving its own way.**
  - `edit` and `write` write the file without CAS and ahead of the record line (`packages/agent-tools/src/edit.ts`). `instant` registers only after the write.
  - `record_write` does not mark the checkout.
  - The command queue, deferred decisions and `unattributed` live only in memory.
  - A command that returned the file to HEAD produces no shift (`ShellRun.ts` `movesOf`), and the lines stay held forever.
  - A line's place depends on where the writing thread stands (`workspace/roots/proof.ts` `placeIn`). On 2026-10-05 two threads from a worktree wrote 207 edits of the canonical checkout through absolute paths that way: nobody sees them, and they stay held forever.
- **Seven ways out:**
  - stamp by plan in `landing/land/submit.ts`, regardless of the reshape outcome;
  - stamp of an emptied change by an `emptied.base` commit that lacks those lines;
  - `dischargeCarried`, `dischargeMoves`, `withdrawGone`;
  - `withdrawVanished` inside the panel read path;
  - `stampTransformed` in `commit_checkout`.

  A HEAD shift is discharged only in checkouts with a served graph mirror: subscription to `ServedMirrors` in `composition/serving.ts`. The commit at discharge is identified as "last to touch the path" (`git log -1`), not as the one that introduced the lines. Lines of a deleted thread are eternal holders.
- **Cost** (details — [[f16c4571]]).
  - `Git.spawn` — 367,047 per hour on October 7 at 02:00 UTC versus 3,606 per hour before the unpack worker appeared.
  - Sidebar recount after an edit takes up to 30 s, waiting on a global `Semaphore(1)`.
  - The panel re-reads all of the thread's paths and the commit list on any fs event at the root.
  - 21,944 held lines outside any checkout hold 836 MB of text.
- **History.** Since August the area has 175 commits, and the defect classes repeat:
  - "worker missing from the release" — 0889b80478 and now unpack;
  - "counter != panel" — 2e3198c8fa, 936b551927, c74b4c00b9;
  - recount rewritten for speed with new caches — 7c7b521701, 0889b80478, a48306e31e, c366505e33.

## Decision

change-record owns one chain of four links:
1. **Entry.** One road by which any source lays down a record line ([[b17adfeb]]).
2. **Attribution.** One fold of marks over record lines, the base and the working bytes ([[359519e0]]).
3. **Holdings.** The ownership model of each checkout and its single judge ([[fe04fc30]]).
4. **Exit.** One driver that moves lines to committed or withdrawn only on proof ([[5fa48d08]]).

Surfaces and operations read Holdings and only Holdings ([[762eb07f]]). Release workers are derived by the build ([[1509a7f0]]). Performance is requirements on each part plus measurable budgets ([[f16c4571]]).

A checkout line (`workspace`) stays pure git. `workspace_change` stays a journal of write facts. Holdings is a derived model: it can be recomputed from the journal, git and disk.

## Invariants

Each invariant is a checkable contract; where each part keeps it is stated there.

- **I1.** A checkout's Holdings domain is paths under held record lines, plus — while a surface cares about the checkout — paths dirty in git status (without graph storage). Every path is in exactly one state: `proven` (holders plus nobody's lines with a reason) or `unknown(reason)`.
- **I2.** For a proven path, Σ `added` over holders plus `added` of nobody's lines equals the `added` of the HEAD→working-file diff. Same for `removed`.
- **I3.** At one revision, the thread badge equals the count of the thread's proven paths in the panel, and the count of paths with undetermined authorship equals the count of the thread's unproven paths in the panel.
- **I4.** "No changes yet" shows only at `current` and zero. No failure ever becomes zero, an empty list, or a "everyone holds" answer.
- **I5.** A read failure on one path never changes other paths' verdicts.
- **I6.** "Unread" is not "absent". On `unknown`, no line is stamped or withdrawn, except file-level proof ([[5fa48d08]]).
- **I7.** A line is stamped with commit C only if C is reachable from HEAD at stamping time, is not an ancestor of that line's `head`, and introduces its lines. "Introduces" means one of three:
  - the diff of C against its first parent contains its lines;
  - for a file judged whole, the blob of C equals its `after` while the first parent's blob does not;
  - for a Tagma landing, the tree of C before the steps holds its lines, recorded by the landing fact.
- **I8.** A landing creates no holderless paths without a reason.
- **I9.** A restart loses nothing recorded. Whatever was not recorded by restart time shows as nobody's with reason `unattributed`.
- **I10.** Deleting a thread and deleting a checkout withdraw their lines, and lines left on disk get reason `released`.
- **I11.** Every worker the server bundle references is present in the install, and starting without any one of them refuses loudly.
- **I12.** A failure or defect of the reread loop never stops later loops.
- **I13.** A path verdict is a pure function of the fingerprint of its inputs. All surfaces receive holders through one code path.
- **I14.** No read writes a record.
- **I15.** An event on a path re-judges only that path. Judging K paths costs O(1 + k) git processes, where k is paths needing git conversion (eol, filter, ident). Not O(K).

## Coverage

- recording edits through all five doors, line place, restart mid-record or mid-command — [[b17adfeb]];
- line-by-line attribution and all its consumers, separability at landing, rollback — [[359519e0]];
- ownership model, judge, domain, failure as data, worktrees, rename, binary, CRLF, large files, gitignored, case-insensitive filesystems, archived, crashed and deleted threads — [[fe04fc30]];
- line exit — landing, steps and hooks, HEAD shift, external `reset`/`checkout`/`stash`/`pull`, thread and checkout deletion — [[5fa48d08]];
- channels, client stores, agent operations, contract and doctrine texts — [[762eb07f]];
- release workers — [[1509a7f0]];
- performance, storage, observability — [[f16c4571]];
- the operator as a holder of lines: their edits from the Tagma editor — [[eefb0e60]].

**out:**
- Fixing today's 15 nobody's files and 207 lost edits is one-off data repair, not architecture. The migration in [[b17adfeb]] returns the 207 edits to their place; the 15 files are fixed by a separate act.
- The "whose command record" decision model (`record/lives.ts`: windows, shortest life, `instant`) stands and stays. What changes is its footing: the decision is made from durable facts only ([[b17adfeb]]).

## What is removed

- **Sidebar and panel.** `record/heldCounts.ts` (`HeldCounts`), the `HeldPaths` service, the `heldPaths` cache in `threads/list/threadList.ts`. From `threadFiles/listing.ts` — weighing (`readList`, `judgeFile`, `fileOf`, `kept`, `printed`, one-shot `landed` display). `threadFiles/weigh.ts`, the `ThreadFileState` on the wire.
- **Holders outside the model.** `record/holding.ts` (`holdersOfRoot`, `writingOfRoot`, `checkoutHolders`) as a standalone output. The `holding()` call while building the checkout line. The `CheckoutWriters` port: it is replaced by the single `CheckoutHoldings` port ([[fe04fc30]]).
- **Former algorithms.**
  - `lines/frontier.ts` `holdersOf`;
  - `lines/attribution.ts` `weighPath`/`landingOf`/`carriedLines`/`authorOf` in their current form;
  - `lines/revert.ts` `revertOf` as a separate algorithm;
  - `record/discharge.ts` in full (`dischargedIds`, `carried`, `reached`, `restores`, `ahead`, `standingAt`, `withdrawGone`, `dischargeMoves`);
  - `landing/land/reshaping.ts` `stampTransformed` and stamping by plan in `landing/land/submit.ts`;
  - `withdrawVanished` from the read path.
- **Old addresses, stores and migrations.** Three alternative place keys, `adoptCanonicalRoot`. The server-side JSONL `record/pending.ts` with the dead `hook-write` view and `migrateLegacyThreadPending`. The outbox of the CLI hook (`pendingWrites`) stays: through it an external harness delivers `record_write` while the server is unreachable.
- **Bindings.** The discharge subscription to `ServedMirrors`. (The hand-written worker list was already removed in f40590b15b.) `packages/git/src/unpack.ts` with its worker ([[f16c4571]]).

## Build order

[[1509a7f0]] → [[b17adfeb]] → [[359519e0]], [[fe04fc30]], [[5fa48d08]], [[762eb07f]] as one delivery: one branch worktree merged whole, because the old outputs are removed in the same change that replaces them (acb620dd). Inside the delivery — [[359519e0]] → [[fe04fc30]] → [[5fa48d08]] ∥ [[762eb07f]]. [[f16c4571]] is the budgets and measurements each delivery is accepted against.
