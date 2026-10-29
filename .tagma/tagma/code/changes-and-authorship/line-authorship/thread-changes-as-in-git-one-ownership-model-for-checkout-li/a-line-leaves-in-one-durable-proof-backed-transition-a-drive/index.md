---
id: 01a1166f-7113-7752-b6b9-0a765fa48d08
title: "A line leaves in one durable proof-backed transition: a driver per checkout, the landing rejudges its commit, step debt instead of nobody files"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/discharge.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/reshape.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/stamping.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/reshaping.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/submit.ts
---
A record line stops being held in one durable transition — `committed{commit}` or `withdrawn{reason}`. One driver per checkout runs it, and only on proof. No line leaves without an answer to where it went, and no path becomes nobody's without a reason.

## What stands now

Seven exit roads:
- **Stamp on plan** in `landing/land/submit.ts`: own and reshape paths are stamped with the commit whether the reshape landed or not. A `kept` reshape (`conflict`, `moved`, `unreadable`) leaves the file in its old form and nobody's. That is how commit 7617026687 left 15 files.
- **An emptied change** is stamped with an `emptied.base` commit that never held these lines.
- **`dischargeCarried` after landing and `dischargeMoves` on a HEAD shift:**
  - `windowMatches` heuristics;
  - the commit is "the last to touch the path" (`git log -1`);
  - an unreadable HEAD blob counts as "not in HEAD";
  - `standingAt` turns a failure into emptiness, and `dischargeMoves` swallows failures (`Effect.ignore`).
- **`withdrawGone`** retires deletion lines on an unreadable HEAD, and ignored-path lines in the pass that touches them.
- **`withdrawVanished`** — from inside a panel read.
- **`stampTransformed`** in `commit_checkout` — on digest match.
- **No exit at all:**
  - a checkout without a served graph mirror never discharges on an external `commit`/`pull`/`reset`: `ServedDischarge.watch` subscribes to `ServedMirrors` (`composition/serving.ts`);
  - lines of a deleted thread (`thread-record/birth.ts` `removeRecords` hard-deletes) and a deleted worktree are eternal holders;
  - lines returned to HEAD by a command are held until the first pass after a restart, which stamps them with a foreign commit.

## One driver

change-record keeps an exit driver on every registered checkout with held lines, with no graph link. Its inputs:
- the judge's verdicts ([[fe04fc30]]);
- HEAD shifts of every checkout (`headMoved` from `workspace`);
- completed landings;
- thread deletion — a `thread-record` event the change record subscribes to (e090f46d), plus a pass at startup: deletion and subscription are never transactional;
- checkout deletion.

**History pass.**
- Each checkout keeps a durable `seen` — the last HEAD handled.
- Each pass reads `(seen, HEAD]` with one `git log --raw` (first-parent and commit blobs per path) and runs transitions. I7 over the whole range is one `Holdings.introduced` batch: one record-line read, one `check-attr`, every blob in one `Git.objects` session, `ls-tree` only on landing trees. The folding walks commits in order, and lines that left on an early commit never enter later ones. Pass decisions write in one transaction at the end, with the same guards; threads' lines with an open command window on the checkout never enter decisions. Holdings publishes one shift per pass. `reverted` candidates are the paths the range touched plus the paths the current Holdings view shows as clean, ignored, or never judged; only they are freshly judged, never all held paths. A path that returned to HEAD unnoticed by the judge gets `reverted` on the pass after the judge sees it. Processes per pass are a constant plus landing-tree counts. The `seen..HEAD` range holds for fast-forward, branch switch, and `reset`.
- A line's `head` is checked in memory against the fetched graph: the commit must not be an ancestor of `head`.
- Startup after idle is the same pass from `seen`.

**Durable-transition guards.**
- A line in `writing` state is never touched by the driver.
- While a thread's command window stands open on the checkout ([[b17adfeb]]), that thread's lines never durably leave: the command may recreate the file.
- Before every transition the driver reconciles the path fingerprint — stat, digest when needed — against the one the verdict was made on. When the path moved, it is rejudged first. This closes checkouts without a watcher ([[fe04fc30]]) and unobserved `stash pop` and terminal edits.

## What is durable and what derives

"A line holds nothing" is derived state, not a transition: another line overwrote it, `git checkout --` rolled it back, or a `stash` hid it. The line stays `held`, and Holdings simply gives it no lines and shows the reason with the panel ("overwritten by B", "returned to HEAD"). So `stash pop`, switching a branch back and forth, and rolling back B's edit of A's line return ownership with no loss.

**Durable transitions:**
- **`committed{C}`** — C from the pass carries this record line's lines (I7).
  - For an external commit — on C's diff against its first parent.
  - For a Tagma landing — on C's pre-step tree. The landing records it as a fact with C, so lines the steps reformatted leave as `committed{C}`. In debt windows the same: session lines are `committed{C}`, and the unformatted remainder on disk is `nobody: steps{C}`.
  - For a file judged whole — C's blob equals the last record line's `after`, and its first parent's blob does not.
  - An external commit reformatted by hooks never recognizes the session's lines, and they leave `reverted`. This approximation is named as deliberate.
- **`withdrawn{reverted}`** — on any checkout HEAD shift, when the record line's lines returned to base and the pass's commits never carried them. So lines returned to HEAD never hang forever. Cost: a `stash` that survived a HEAD shift gives nobody `external` lines after `pop`.
- **`withdrawn{overwritten}`** — only when the overwriter's line leaves, by commit or withdrawal. While the overwriter holds the line, rolling back its edit returns A's line. When A is already withdrawn and its line is back on disk, that line's mark is `nobody: released{A, overwritten}`.
- **`withdrawn{formed}`** — the commit steps brought the session's version to HEAD, and there is nothing to commit. The `emptied.base` commit is never set again.
- **`withdrawn{thread-deleted}`** — thread deletion.
- **`withdrawn{checkout-gone}`** — only on explicit checkout deletion. The root registry's daily healing (`workspace/roots/healing.ts`) never downroots a root holding record lines. It learns this through the workspace port the change record fills (e090f46d). A renamed directory is then found by witness: the registry moves the root, root_id stays (7f27226d7f). The worktree archive commits the remains (`worktrees/retirement/archive.ts`) and rejudges its commit in the same act; only what never entered it is withdrawn.
- **`withdrawn{outside}`** — ignored-path lines on thread archive.

What a withdrawn line left on disk, Holdings shows as `nobody: released{thread, reason}`; the witness keeps each line's span and digest before and after, without texts, until the next commit touching the path, when the seen pass with rebasing deletes the witness, and a later return counts as a new external edit.

**File-level proof.** On `opaque` from a missing historical text, a file a commit introduced is judged by digest: the thread's last record's `after` must match the commit's blob and differ from its first parent's blob. The match keeps the record's reference to the carrying commit; the kept text itself never proves authorship. Unreadable sides and an exhausted budget never give such proof. When the working file equals the HEAD blob, the path's lines hold nothing more — even on `unknown` lines — and without a proven carrying commit they leave `reverted` (I6).

## Landing

- **There is no stamp plan.** The landing leases its paths from the judge for the "publish → reshape → rejudge" stretch, so the HEAD-shift driver never judges mid-way. After publishing, in the same act before answering, it rejudges the commit's paths against the new HEAD and runs the driver pass on its own commit. The answer names what this commit carried away and which own lines still stand.
- **The delta a commit gained beside the session's lines comes in three kinds:**
  - **The step and hook delta that entered the commit** (`8682e2b1`).
    - Inputs — the before and after blobs and each path's disk bytes — are read before publishing. An unreadable input is a `reshape-unreadable` refusal with the path, and nothing is published.
    - Per file — all or nothing, as now: a three-way merge either lands whole or on `conflict`/`moved` the file is untouched.
    - An unmerged file is a durable "step debt" fact: path, commit, the steps' before and after blobs. Holdings marks `nobody: steps{commit}` on the HEAD→disk diff lines matching the "before steps" side in the debt windows. The landing answer names the debt in `owed`.
  - **Hook edits that never entered the commit** (`committing.left`) are still held by the session, as now.
  - **`post-commit` hook edits** arrive after publishing and cannot be read ahead. The landing and `commit_checkout` lift them out of the commit tree (blob C → post-hook blob) and bring them in with a three-way merge as nobody's uncommitted lines. A file where the edit did not land is a debt with `source: post-commit` and a reason (`conflict`/`moved`), in the same window model: the driver writes the hook's text into a window where the disk holds text C with no held lines. Differences from step debt:
    - the windows' target is the hook's text, not HEAD, so a file level with HEAD never clears the debt;
    - while a step debt stands on the path, the `post-commit` debt waits: its windows are described over text C;
    - a commit that later touched the path closes the debt: the hook's edit no longer belongs to it;
    - Holdings never marks its lines `steps{C}`: on disk these are HEAD lines.
- **The driver clears debt** (a00f91b0: connects in the same delivery).
  - At startup and on every shift of the path (a landing or an edit by whoever whose lines blocked) the driver checks the debt windows.
  - A window with no held-thread lines, no running turn, and no open command window on the path is replaced with the window's text from HEAD through CAS `LineWrites`. There is no repeat three-way merge: it never converges while lines that left for HEAD stay on disk.
  - Debt closes when none of its windows diverges from HEAD anymore.

  Step lines are nobody's, not the session's: a formatter rewrites lines the session never wrote. Relanding an unformatted file would never converge — the steps would reformat it again.
- **`commit_checkout`** is the same path: lease, pre-step tree fact, rejudge, reshape. `stampTransformed` is deleted.

## HEAD shift outside Tagma

Commit, pull, reset, checkout, rebase — the same `(seen, HEAD]` pass: the judge rejudges the touched held paths, the driver runs transitions. A human's terminal commit carrying the thread's lines stamps them. `reset --hard` to HEAD immediately makes the lines "returned" as state; they durably become `reverted` on the next HEAD shift. A commit that carried no lines never carries them away — neither at startup nor later (I7).

## Reading never writes

Neither the panel, nor counters, nor any `read_*` runs transitions (I14).

## Acceptance

- **I6.** A HEAD shift on an unreadable HEAD blob of a file the thread deleted: no stamp, no withdrawal, the path is `unknown(unread)`.
- **I7.**
  - a pull of five commits, the thread's lines carried by the third — the lines are `committed` by the third.
  - Lines returned to HEAD by a command, then a foreign commit — `reverted`, not that commit.
  - A landing with a formatter step that rewrote the session's lines — the lines are `committed` by the landing commit, and the commit stands in the thread's "Commits".
- **Rollback and guards.**
  - B overwrote A's line, then a third thread's landing shifted HEAD, then B rolled back its edit — A holds the line again.
  - `stash` → `stash pop` with no HEAD shift — ownership as before.
  - A thread's command recreates a file (`rm` plus generate) while someone else's landing shifts HEAD — the thread's lines never leave.
- **I8.**
  - A landing with a formatter step over a file where a second thread holds lines, merge in conflict — the file untouched, a debt in `owed`, the session lines `committed{C}`, the remainder in windows — `nobody: steps{C}`.
  - After the second thread's landing the driver replaces the freed windows with HEAD text — the path is clean, debt closed.
- **reshape-unreadable.** Unavailable reshape inputs are a refusal, nothing published, working files untouched.
- **Opaque line.** A byteless line, the file later level with HEAD — the path is clean, the line left.
- **I10.**
  - Thread deletion — its lines `thread-deleted`, the on-disk remainder `released`.
  - Worktree archive — the remains commit rejudged, the rest `checkout-gone`.
- **I14.** Holdings, `read_changes`, `read_checkout`, `read_authorship` reads answer while the store is closed for writing.
- **Checkout without a graph mirror.** A human's terminal commit carrying the thread's lines — the lines are `committed` by that commit.
