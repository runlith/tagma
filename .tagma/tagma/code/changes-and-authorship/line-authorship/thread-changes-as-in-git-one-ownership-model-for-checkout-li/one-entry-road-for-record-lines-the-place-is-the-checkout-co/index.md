---
id: 01a1166f-7113-7752-b6b9-0a73b17adfeb
title: "One entry road for record lines: the place is the checkout containing the file; the fact is written before the file; the command journal survives a restart"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/operations/record.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/commandRows.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/commands.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/heads.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intake.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/intents.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/journal.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/places.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/recovery.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/store/commandTables.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/store/steps.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/store/tables.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/roots/proof.ts
  - kind: file
    ref: packages/agent-tools/src/edit.ts
  - kind: file
    ref: packages/agent-tools/src/ShellRun.ts
---
A record line is a fact: a thread moved a file from one version to another. Everything Holdings knows derives from these facts, git, and disk. So every source lays the fact the same way, in one place, and before it can be lost.

## What stands now

Five entry roads, each with its own behavior:
- **Typed tools** (`record/write.ts` `ChangeLog`).
  - `edit`/`write` read the file, count, and write without CAS (`packages/agent-tools/src/edit.ts`), and lay the record line after writing the file.
  - `instant` — the "thread T writes this version" mark — registers after the write. So a parallel shell command can claim the same record for itself.
  - On store failure the fact goes to a side JSONL (`record/pending.ts`). It merges at startup, on the same thread's next write, or on rollback.
- **Commands** (`record/commands.ts` → `queue.ts` → `commandRows.ts`).
  - The queue, deferred decisions, and the `unattributed` list live in memory: a restart between a command's end and the line write loses attribution.
  - A file the command returned to HEAD (`git checkout --`, `restore`, `stash`) yields no shift: `ShellRun.ts` `movesOf` drops names that left dirty.
  - A file past `versionContentLimit` gets a `too-large:` digest and is held forever.
- **`record_write` of external harnesses** (`operations/record.ts`): no `instant`, no `checkouts.marked`, publication without places, and a born file is written with `before ''`.
- **Line rollback and reshape** with `held` — their own `records` calls.

A line's place (`workspace/roots/proof.ts` `placeIn`) is counted from the root where the writing thread stands. An edit to another registered checkout's file is written as an absolute path with no coordinates. That is how 207 canonical-checkout edits by threads 01a10949 and 01a10a1f, working from a worktree, were recorded on 2026-10-05.

One place is addressed by three alternative keys: `namespaceId`+`resource`, `rootWitness`+`path`, `resource IS NULL`+`path`. Lines with `resource IS NULL` match any checkout of the project. `adoptCanonicalRoot` is a runtime migration with an in-memory flag.

21,944 lines on absolute paths outside any checkout are held forever.

## Goal

**One entry road.** Every source — a tool door, a command, `record_write`, rollback, reshape — lays facts with one intake call from change-record. One call gives one behavior: place, mark, place publication, and checkout marking.

**Place is the checkout containing the file.**
- Intake resolves the file's absolute path against the project's registered roots: canonical, its worktrees, a nested registered repository. The place is `(checkout, relative path)`, where checkout is the stable id of the registered root, proven by witness (b77b7a93). Where the writing thread stands never matters.
- The path is recorded in the spelling this checkout's git knows. On a case-insensitive FS the path is brought to the index or on-disk spelling, so the file has one name.
- The graph store (`.tagma`) is never recorded.
- A file outside any registered checkout never becomes a record line. Such a turn's history stays in the thread journal: in the tool call and in the command answer.

**Typed write: fact before file.**
1. Writers of one `(checkout, path)` queue inside the server.
2. The intent — a line in `writing` state with `before`/`after` digests and texts — is written to the store, and the mark registers.
3. The file is written through CAS: only when the bytes have not moved since the read (tool doors — `changed.ts` `replaced`, rollback and reshape — the `LineWrites` port). New bytes land in a temp file beside it, the standing file's digest is checked once more, and the temp file is atomically renamed over, preserving mode; writing through a symlink changes its target. Creation is exclusive: a file that appeared after the read is never overwritten. The residual race with an external writer is microseconds between check and rename; the record stays truthful because the command sees the shift. Step 1 guards between typed writers.
4. The line confirms.

Outcomes:
- CAS missed — the intent is dropped, the tool answers "file changed, re-read".
- Store unreachable before the file write — the tool refuses without touching the file.
- At startup an unconfirmed intent confirms when the on-disk bytes equal its `after`; drops when they equal `before`. On any other content it drops, and the file's lines are judged as they stand ([[fe04fc30]]).
- The side JSONL goes away. It only existed so a file write could survive a store failure. That case is gone: on failure the tool refuses instead of writing past the record.
- Cost: two store-queue writes per edit before the tool answers. The p99 budget is [[f16c4571]].

**Operator holder and merge.** Intake takes a holder `{kind: 'thread'} | {kind: 'operator'}` (`IntakeWork.holder`); the `workspace_change.holder` column stores the thread uuid or `operator`. Operator edits from the Tagma editor ([[eefb0e60]]) take the same typed road through the `Intake` service tag (`turn`, `land`). Autosave writes once a second, so an operator record W confirms by merging into a record R when R is the operator's held line on the same path, the last standing one on it, `R.after = W.before`, neither is a deletion, move, or rollback, and the checkout has no command window opened after `R.at`. "Fact before file" order holds: the W intent, the CAS write, then in one unit — `R.after = W.after`, R's hunk recomputed in a worker, W deleted, the intermediate version freed. A restart between write and merge decides W the ordinary way.

**`record_write` is a post-fact.** An external harness writes the file itself and reports after the write. There is no intent or CAS here. Intake registers the mark and the line when told, and gives the same place, publication, and marking. The guarantee is weaker, and the operation contract says so: between the file write and the report, a parallel command can take the shift for itself.

**Command as a durable journal.**
- Before the process launches, the journal gets a window — thread, checkout, HEAD, start — and the dirty-path base from `packages/agent-tools/src/CheckoutBaselines.ts` `measure`: digests and available texts. Text is stored once per digest, and the window holds a reference until all its shifts decide; collection counts it alongside uncompleted record lines. Holding an observation proves no author and holds independently of the overlap decision.
- On settle, one unit writes the window end and the observed shifts: name, `before`/`after` digest, mode. On settle — digests only; base texts are already held. The hunk-counting pass reads result bytes from disk later, with a digest check, like `commandRows.ts` `tailOf`. On mismatch — the shift stays at file level.
- Whose command shift it is, is decided only on durable facts: tool lines (they are the `instant`), command windows, and reshape nobody records (`Lives.unowned` becomes a fact). `record/lives.ts` caches these facts instead of being their only carrier, so the decision after a restart is the same.
- A thread gets the shift only when it alone explains it: this thread's record mark (`instant` from intent to file write) or, without marks, one thread's command windows at the write moment (mtime ± WRITE_GAP, without mtime — the whole window). When several threads' command windows cover the shift and no mark explains it unambiguously, it is attributed to nobody: each of these commands gets `unattributed` with reason `overlap`, and the path shows unproven (I6). Command life length never decides: the "shorter means it wrote" rule once gave a `python`-script record to a neighbor thread's read-only `grep`. The author lands such a file by naming it in `submit_work paths` with `whole: true`: a path's nobody lines with no other holders ride whole.
- A window open at restart closes at the restart moment. A path whose startup digest differs from the one recorded at window opening gets nobody lines with reason `unattributed{thread, restart}` when no other fact explains it ([[fe04fc30]]). With no recorded base the path is honestly `external`.
- A file returned to HEAD is a shift too (`after` = HEAD blob or missing): `movesOf` stops dropping names that left dirty.

**Renaming.**
- Intake links a deletion + creation pair when one turn recorded them (a typed `move`'s `recordingMove`, or a command that gave both shifts in one window with equal digests).
- The link is stored as a fact and serves `Holding.from`. Git gives renames for staged paths only, so without this fact an unstaged rename would fall apart into two unlinked paths.

**Positional hunk.**
- `LineHunk` (`packages/files/src/hunk.ts`) carries the change's exact span:
  - `firstLine`;
  - `oldLines` and `newLines` — how many lines are replaced and how many inserted;
  - `windowBefore` — how many context lines of `oldText`/`newText` stand before the change.
- Right now `oldText`/`newText` are widened with context (`widening`), and how many old lines were replaced is never stored. So a record line cannot apply to the folding front without a window search ([[359519e0]]).
- Intake writes the span on every road's lines. Migration-era lines have none: the folding prepares it.

**Rollback fact.** A record line written by `revert_lines` carries `reverts` — the cancelled record lines' ids. Otherwise, after a cold recompute, the folding cannot tell a rollback from an edit that matched the earlier text, and never returns the source marks ([[359519e0]]).

**Digest is over bytes.** A version digest counts on raw file bytes — the same for tools and commands. Text decodes only for line work. A file past the text limit gets its true byte digest, counted by a stream in the server process, and is judged at file level ([[359519e0]]). A large file's digest caches on the stat key (size, mtime, ctime, inode), as in the git index; a file whose mtime or ctime falls in the same second as the measurement never caches.

**Record-line schema.**
- `checkout` NOT NULL instead of the `namespaceId`/`rootWitness`/`resource` triple.
- `head` — the checkout's HEAD at write time. It is the lower bound of the commit that can carry it away (I7).
- State: `writing` → `held` → `committed{commit}` | `withdrawn{reason}`.

One-shot migration, as a drizzle step:
- every line's place resolves to a checkout on the old triple or the absolute path inside a registered root. That is how the 207 edits return to canonical-checkout;
- lines outside any checkout are deleted: they have no checkout, and `checkout` is NOT NULL. Versions only they held are freed by the collector's full pass (`sweepVersions`, `c851d6c3`);
- old lines have unknown `head`. The exit driver's first pass ([[5fa48d08]]) stamps them the current HEAD with no transitions: past commits never carry such lines away, and ones holding nothing leave as `reverted` on the next HEAD shift;
- lines of threads that no longer exist get `withdrawn{thread-deleted}`;
- `adoptCanonicalRoot` and `migrateLegacyThreadPending` go away.

## Owners

- intake (`record/intake.ts`), intent resolution at startup (`record/intents.ts`), the command journal (`record/journal.ts`, `record/recovery.ts`, `store/commandTables.ts`), and `LineWrites` — change-record; composition fills `LineWrites`;
- `edit`/`write`/`delete`/`rename`/`import_output`/`strip_comments` doors and `save_agent` — through the `WorkspaceChanges` port: `turn(path, work)` queues the door at its place, `land(changes, write)` hands intake the facts and the record, and intake itself writes the intent, runs the write, and confirms the line;
- window `movesOf` and base digests — `packages/agent-tools` (`ShellRun.ts`, `CheckoutBaselines.ts`);
- place resolution against all roots — `workspace/checkouts` (`CheckoutPaths`); root moves with the same witness — `workspace/roots`.

## Acceptance

- A thread from a worktree edits a canonical-checkout file — the line stands in canonical, and canonical Holdings names the thread holder.
- Two typed `edit` writes of one file at the same time queue, and each record line matches the bytes on disk. A shell write between an `edit`'s read and write is a "file changed" refusal.
- Killing the server after a tool's file write, before confirm: after startup the line confirms, and the thread holds its lines.
- Killing the server mid-command while it edits a dirty path: after startup the path carries nobody lines with reason `unattributed{thread, restart}`, not silently held lines.
- A `git checkout -- f` command on a file where the thread held lines yields a shift. The thread stops holding lines ([[5fa48d08]]).
- A file past the limit, written by a command: the holder is the thread whose `after` equals the bytes' digest.
- After migration no lines lack `checkout`. `workspace_change_content` is freed of versions only lines outside checkouts held.
