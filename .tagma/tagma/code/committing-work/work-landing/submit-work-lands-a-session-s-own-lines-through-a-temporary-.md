---
id: 01a0d0a7-c14d-73e8-a333-1f082a55b1e4
title: submit_work lands a session's own lines through a temporary index, carries a peer's where they cannot be cut apart, and no prompt or refusal invites negotiating a commit
ord: 128
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/attribution.ts
  - kind: file
    ref: apps/tagma/server/src/doctrine/sections/gitAndGithub.ts
  - kind: file
    ref: apps/tagma/server/src/doctrine/sections/theSharedCheckout.ts
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/submit.ts
    symbol: submitWork
  - kind: symbol
    ref: packages/agent-tools/src/shellShapes.ts
    symbol: sweepShape
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
    symbol: concurrentGround
---
The operator's word (2026-09-23, relayed by the tagma agent): no bureaucracy between agents over commits. Every agent commits its own work itself as soon as it is ready; when its lines cannot be cut away from a peer's, it commits the peer's lines along with its own and writes to nobody. Rule [[621b98d5]] says this for runlith today; this decision makes Tagma itself work that way for every project.

## 1. Outcome

- `submit_work` lands the lines this session wrote. Another live session's unfinished lines in the same file stay in the working tree, out of the commit. The shared index is never used to build the commit.
- Where the session's own lines cannot be separated from a live peer's, or the agent passes `whole: true`, the file goes in whole and the receipt names it under `carried` with the sessions whose lines rode along. Nothing refuses over a peer's lines, and nothing needs a message.
- The doctrine and the collaboration voice say one thing: commit your own work yourself at once, never write to another agent about a commit. The only question worth a message is a genuine edit conflict: two writers changing the same lines.
- A bare `git commit` in a shared checkout is refused outright, naming `submit_work`. No commit road asks a reader.

## 2. Problem and evidence

On 2026-09-23 build-request-obligation lost 10 minutes (23:02–23:12 UTC) to compaction-collab's "take your hunks out / put them back / take them out again", then handed its own line to compaction-pin's commit `31226bdcd8`. The same day build-host-lanes, build-stop-ladder and build-server-lanes agreed a landing order over 8 shared files. There are three causes:
- `submit_work` commits whole files, so a shared file carries the peer's lines;
- the doctrine and the voice read as "HEAD must build, do not divide a change, coordinate with the holder";
- committing one's own hunks by hand is refused for every spawned agent: a bare `git commit` is a sweep ([[3b6b9a9f]]), a sweep asks the reader, and a child is never interactive, so the ask becomes an `unattended` refusal that names no way out.

## 3. What holds now (read 2026-09-23)

- `apps/tagma/server/src/harness/submitWork.ts#submitWork` runs `git add -- <paths>` and `git commit -- <paths>` over every held path, whole ([[290d8b5c]], [[15263a08]]). It names live co-holders under `shared`. `paths` matches files only, so a directory answers `nothing` (reflections [[586cb4ca]], [[f5162cb5]]). All paths ride one argv, which overflows the host's 16 KiB envelope ([[4c216a8d]]). An add followed by a failed commit leaves the shared index moved ([[0c1d6627]]).
- `apps/tagma/server/src/files/attribution.ts#weighPath` already answers what a commit of a session's own placeable rows would carry: HEAD plus the carriers' replay, with `residue` when the file holds bytes no record explains ([[2077e844]], [[e1d6ffee]], [[6aa7ced4]]). Today only the thread file list reads it.
- `packages/agent-tools/src/shellShapes.ts#sweepShape` judges a bare `git commit` a sweep ([[4e13d857]]). `bash.ts` declares a reader for it. The door's synthetic ask carries no reason, so an unattended run reads "a rule of this run asks about it".
- `holdLanding` has no landing caller; `WorkspaceChangeLog.ts` imports it and never calls it (task [[ef42cd77]]).
- The doctrine sections `theSharedCheckout.ts` and `gitAndGithub.ts`, `CollaborationVoice.ts#concurrentGround` and `#branchBirth`, and the operation text in `protocol/operations/graph.ts` invite asking, waiting and telling the holder.

## 4. Target model

Per path, `landingOf` (attribution.ts, pure) decides one of three landings:
- **own**: some live session other than the carriers holds typed rows on the path, and `weighPath` answers `carry` with no residue. The path lands at the carry text: HEAD plus the carriers' replay. An ended session's rows on the path are adopted as carriers, so writing nobody will ever commit rides along instead of being left behind.
- **whole**: no live peer holds the path; or the weighing answers `unproven`, a refusal, or `carry` with residue; or the working file is missing, binary, a symlink or past the reading cap; or HEAD's blob cannot be read; or `whole: true` was asked. The working file lands as it stands.
- **none**: the weighing answers `settled`: the carriers' net on this path is already what HEAD holds.

`submitWork` then holds the carriers' run admission (`holdLanding`) for the whole span and, under the per-root gate:
1. reads HEAD as the base;
2. builds a temporary index under the git dir: `read-tree <base>`, `update-index --add --remove --stdin` for every landed path, then for own paths a blob from `hash-object -w --stdin --path` placed with `update-index --index-info` under the mode git chose;
3. answers `nothing` when that index does not differ from the base;
4. re-reads HEAD, and rebuilds if it moved;
5. commits with `git commit` under `GIT_INDEX_FILE`, so the repository's hooks and identity apply as before;
6. checks the new commit's parent. If a foreign commit slipped in between, it rebuilds on that parent and replaces its own fresh commit with `commit-tree` and a compare-and-swap `update-ref`;
7. brings the shared index to the commit for the landed paths whose index entry still equalled the base (`reset --pathspec-from-file`). An entry somebody staged is left alone;
8. stamps the own rows it carried by id, and discharges the rest as today.

Every path list crosses to git on stdin or in bounded chunks, never in one argv. `paths` entries name files or directories.

Answer: `landed` with `commit`, `paths` (what changed in the commit) and `carried` (path and live holders, for files that went whole with another live session's lines in them); `nothing`; or `refused` with git's words. The index sync is retried on `index.lock`. If it still fails, `unsynced` lists the paths whose index entry is left at the base.

## 5. Owners and boundaries

- `files/attribution.ts` (area [[372b147b]]) owns the per-path landing decision. It stays pure: no git, no store.
- `harness/submitWork.ts` (area [[12972a3b]]) owns the git acts, the temporary index, the gate, the admission hold and the receipt.
- `protocol/submitReceipt.ts` and `projection/lines.ts` own the answer's shape and its words.
- `packages/agent-tools` owns the shell judgement: the commit sweep becomes a refusal naming `submit_work`. The kernel's reader-ask path in `packages/agent` is not touched.
- The doctrine sections and `CollaborationVoice.ts` own the prompts.

## 6. Rejected alternatives

- **`commit-tree` plus `update-ref` for every commit.** This is race-free, but it skips the repository's hooks, and a skipped hook needs the operator's word. `git commit` runs the hooks. The rare commit that slips in between is repaired by rebuilding and replacing only our own fresh commit.
- **A three-way `merge-tree` repair.** Re-running the same planner on the new parent needs no second algorithm, and it stays correct when the foreign commit touched our paths.
- **Staging own hunks in the shared index.** This is what the operator forbade: it disturbs every other writer's view and races their `git add`.
- **Asking the reader, with the reason carried into the unattended refusal.** A spawned agent would still reach a road that asks, and an interactive operator would be asked about something `submit_work` does without asking.
- **Leaving an ended session's lines out.** Nobody would ever commit them.

## 7. Acceptance criteria

1. Two sessions edit one file in separate hunks. Each `submit_work` lands only its own hunk; the other's hunk stays in the working tree; no message passes between them. After both, HEAD equals the working file.
2. A session whose edit sits on a peer's lines (the same lines) lands with the peer's lines carried, and `carried` names the path with that peer.
3. `whole: true` carries a separable peer's lines too.
4. After an own-lines landing, `git status` shows the peer's hunk as unstaged, the landed path is not staged, and an entry somebody else staged stays as they staged it.
5. `paths: ["src"]` lands the held files under `src`.
6. A foreign commit landing between our build and our commit is not reverted: the final commit's parent is that foreign commit, and its changes survive.
7. More paths than one argv can carry land in one call.
8. A bare `git commit` in a shared checkout is refused, outside bypass, with a reason naming `submit_work`. No reader is declared for it.
9. No sentence in the touched prompts invites asking, waiting, handing over or telling about a commit.
10. `holdLanding` has a landing caller, and the dead import is gone.

## 8. Claims and tasks touched

- [[290d8b5c]] (whole and named) is superseded by claims written from the new code: own lines by default, carried when inseparable or asked.
- [[15263a08]] is reconciled for directories in `paths`.
- [[65bc1a39]] is reconciled: the gate now spans build, commit and sync, and the shared index is no longer staged.
- [[684269e7]] is reconciled: `nothing` is now measured on the temporary index.
- [[f79422fc]] stands.
- [[3b6b9a9f]] and [[4e13d857]] are reconciled: a bare commit is refused rather than asked.
- [[2077e844]] is reread, because its reader is now also the commit.
- Task [[ef42cd77]] is taken along and finished: `submitWork` holds admission.
- Reflections [[4c216a8d]], [[586cb4ca]], [[f5162cb5]] and [[0c1d6627]] are answered by this change.
- Task [[01ae8335]] implements this decision.

## 9. Order of building

1. `landingOf` in attribution.ts.
2. `submitWork` over the temporary index, with the receipt, projection, operation text and fixture.
3. The floor tests.
4. The sweep refusal.
5. The prompts.
6. Review by two reviewers.
7. Claims, doctor, close.

## 10. Contract

The receipt's `shared` becomes `carried`, and `unsynced?` is added. Both are read only by this server's projection and the CLI decoder, which ship together, so there is no version to bump. `submit_work` gains the optional `whole`. `paths` now also accepts directories, which widens it without breaking any caller.

## 11. Stored data

out: no schema or row shape changes. Rows are stamped by id through the existing `stampCarried`.

## 12. Who may do what

The session decides its own landing; the change record decides which lines are its own. A wrong attribution errs toward carrying: anything unproven lands whole. A peer's lines may reach a commit early, but no session's lines are ever lost from the working tree. `taking` keeps its existing checks: a descendant, not running.

## 13. Long-lived things

The temporary index file lives under the git dir for one landing, and is removed in a finalizer together with any `.lock` left beside it. The admission hold and the gate are released by scope.

## 14. Bounded resources

A working file past 4 MB, or a binary one, is not weighed; it lands whole. Path lists cross on stdin, or in chunks of 100 where git takes no stdin, so the 16 KiB call envelope is never reached.

## 15. Rollout

The running server keeps the old whole-file behaviour until the operator restarts it. Nothing in flight depends on the change.

## 16. Failures

- **A foreign commit between build and commit:** the build is repaired onto that commit (step 6).
- **HEAD moving again during the repair:** the compare-and-swap fails, and the commit stands as landed.
- **`index.lock` during the sync:** retried with backoff, then reported as `unsynced`.
- **A hook refusing:** `refused` with git's words. The shared index was never touched.
- **The process dying mid-landing:** the temporary index is orphaned under the git dir and the shared index is unchanged.

## 17. Observability

The receipt names each carried file and its holders. `git status` after a landing shows the peer's lines as unstaged. Every git call is traced under its `submit-*` op name.
