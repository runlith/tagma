---
id: 01a111ab-9639-7730-81d5-593018d06fb3
title: "Everything a command changed in the checkout records itself onto its session: no `produces`, no pre-launch refusals, no observation road"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0d5b9-9b63-7a8b-9893-9140f1f839ad
  - kind: relates
    to: 01a0dbac-14e8-7aff-a0c7-0c2684694b75
  - kind: relates
    to: 01a10323-2fc7-78fa-8d6d-620a6ce62961
  - kind: relates
    to: 01a10e90-e5df-75be-81ac-d86529fd9261
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/write.ts
  - kind: file
    ref: packages/agent-tools/src/importFile.ts
  - kind: file
    ref: packages/agent-tools/src/ShellRun.ts
---
## What the user gets

An agent runs any command — a script, a generator, a codemod, a formatter — and declares nothing about it. Files the command created, changed, or deleted in the checkout are recorded on its session just like an `edit`: `submit_work` lands them, a turn rollback rolls them back, the thread's file list shows them. No command is refused for authorship reasons. The command's answer lists what was recorded on the session.

## Why

Right now a command's edits become the session's work only through `produces` — a claim the agent guesses before launching. On a sample of runlith threads over 8 hours on 2026-10-05 (4885 `bash` calls):
- 22 of 618 calls with a claim never launched: someone else's line somewhere in the claimed file, a concurrent edit of the same step by its own session (`declared-subject-changed`), an ignored path, another tree;
- 198 commands changed files outside the claim, and `submit_work` does not land them ([[f1f839ad|40 perl files]]);
- the claim costs another ~200 ms per folder and ~560 ms per `.` over snapshots (one measurement), 407 paths hung one call for 15 minutes ([[84694b75|reflection]]);
- a binary file cannot be claimed ([[29fd9261|generated image]]).

## How it works

The checkout snapshots before and after every command stay (`CheckoutBaselines`), and they already know everything needed: which paths moved, their bytes and write times. The command's answer carries only the decision made in memory; a background change-record queue writes the lines; session reads wait only on its own lane, a landing only on the records touching the landed paths — and nothing new appears on the answer path, including waiting for a queue slot.

1. **Decision by bytes.** A path moved according to the git list is not yet an edit:
   - digest unchanged — nothing;
   - after the command the path is clean against HEAD (it was committed, `git checkout -- <path>`, `stash`, pull) — nothing;
   - the path is gone — a deletion;
   - otherwise — a change;
   - the path did not read before or after — nothing, the path is named in the answer.
2. **Write time.** The "after" snapshot already stats every dirty path; its mtime t is the write time if t falls inside the command window — from the start of the "before" snapshot to the end of the "after" snapshot. Otherwise the parent directory's mtime is taken if it falls in the window: this catches `mv`, `git mv`, a new file from `cp -p` or `tar`, and deletion. Otherwise t is unknown, and the write time is the whole window. mtime is currently read and thrown away (`packages/files/src/working.ts`, frontier in `CheckoutBaselines.ts`); it is carried to the decision without a new call, from the stat taken after the bytes were read.
3. **Candidates are live processes.** The server keeps an in-memory registry per checkout: the life of every native command process — from handover to the host to the completion answer, on wall clocks — its session, and whether it is still running. `write`, `edit`, and `import_output` edits enter it with an instant life at write time. A candidate is whoever lived at the moment t ± 20 ms (the slack covers filesystem clock granularity: up to 10 ms on ext4, up to 15.6 ms on NTFS) or overlapped the window when t is unknown. Candidates of one session are one candidate.
4. **Decision.** One candidate — the edit is theirs. Several — the edit goes to the shortest-lived process; on a tie, to the one that started later. Each command decides only for itself and writes only on its own session; the loser stays silent, the winner records itself. So in a long test overlapping a short script of another agent, everything recorded while the script lived goes to the script.
5. **Deferred decision.** If a still-running candidate is shorter than the deciding command so far, the path waits for its end or for the moment it grows longer — no longer than the deciding command's own duration — and the decision repeats. The command's answer names the path as deferred and does not wait. `submit_work` decides its own session's deferred paths immediately, on the lives at that moment.
6. **The base is a version chain, not time.** Uncommitted edits of a path by any session form a chain of versions by hash. The change record finds the "before" digest in it and walks every edit after it in order. A link whose "before" does not match the previous version is a break: that transition is decided by rules 3–5 with unknown t and takes its own place in the chain. The tail runs from the chain's last version to "after". So an own or another parallel `write`/`edit` does not enter the command's edit, and the command's edit is not lost when someone else edits the same file right after.
7. **No duplicates.** When the "after" version already stands in the path's uncommitted edits, the tail is not written; breaks are written; committed versions do not count — restoring an old version from history stays an edit. Lookup and insert happen in one write unit. So `git stash pop` does not record someone else's edits on itself.
8. **The "before" text.** For a clean path — the file text in the "before" snapshot's commit (not the current HEAD: it moves inside the window) in git working form, in one batched read per queue pass. For a dirty path — the text from the change-record version store by digest. With no text — a version from an editor or watcher, a binary file, over 16 MiB, a symlink — the edit is recorded whole-file; for a file over 16 MiB only the size change is visible. The "after" bytes are the ones the "after" snapshot already read to compute the digest, not a second read.
9. **Someone else’s lines stay someone else’s** where the edit has a "before" text: per-line authorship is the same as for an `edit`, which does not check holders. A whole-file edit makes the session the holder of the whole file, and it lands whole.
10. Ignored paths and `.tagma` are never recorded — nobody lands them.

**Accuracy limit.** Without privileges and without instrumenting child processes, no OS reports which process wrote a file, so authorship is inferred from who lived at the write moment. Sample 2026-10-05 22:34 – 2026-10-06 15:01 UTC (29 threads, 1609 native commands with a known process life, 340 of them text-writing by content, recording at a random moment of the writer's life):
- **wrong** — at the write moment a shorter process of another session lived that wrote nothing (`rg`, `git status`): 0.70% of writing commands;
- **right thanks to rule 4** — at the write moment a longer process of another session lived (tests): 11.7% of writing commands; a "first finished wins" rule would be wrong here;
- **right thanks to rule 5** — the decision had to be deferred: 0.43%.

Not measured: writers outside the registry — `start_terminal` processes, the external CLI's own Bash, the operator's editor, commands that survived a server restart — their record goes to the native command that lived at t, or to nobody; recording over a file with a preserved mtime (`cp -p` over an existing file, `touch -d`), where the time is the whole window; two sessions recording one path inside one snapshot delay. A background command is the longest, so it only gets what no shorter process lived through. When a command missed a path because another session got it, its answer names that session.

## One form on every platform

The mechanism is git and file reads, with no per-OS code ([[6f758080|the kernel knows no variants]]). To behave the same on Windows, Linux, and macOS:
- **Working form from git.** One reader in `packages/git` serves commit files in working form — eol, `working-tree-encoding`, filters, BOM, true size: `git archive` by commit and paths, one process. A raw blob via `cat-file --batch` does not give this, and `--filters` reports the pre-filter size in the header. The same reader serves every base compared against working bytes or edit texts: holders (`record/holding.ts`), landing (`prepared/tree.ts`), turn rollback (`record/runFiles.ts`), the file panel (`threadFiles/weigh.ts`), counters (`record/heldCounts.ts`), discharge (`record/discharge.ts`); the raw blob stays where the repository form is needed (`landing/land/indexSync.ts`, `prepared/subject.ts`). Right now they read the raw blob, and on a CRLF file the whole file looks changed. A path `git archive` did not return (`export-ignore`, including on a directory), a path with `$Format:` (it would have been rewritten by `export-subst`), and the whole batch on archive failure are read with `git cat-file --filters <commit>:<path>` one by one; reading one or two paths always goes that way, without archive.
- **BOM is never stripped** anywhere an edit text is read — `edit`/`write` (`readFileString` strips it, and `edit` writes the file back without it), a command's edit, `textsAt`: the snapshot digest and the text digest must match.
- **An unreadable file** — held by another process, blocked by antivirus — is skipped and named; only its record in the frontier is reset, not the whole frontier.
- **A symlink** is read through lstat and recorded whole as its link text: a dangling link is not a deletion, a link to a directory is not a read error.
- **A path** is recorded as git names it — `/`, index spelling, not `path.relative`; edit lookup honors `core.ignorecase`.
- **A line ending is not an edit where git normalizes it** (`core.autocrlf`, `text` and `eol` attributes): for such a path lines compare without the line ending — in the hunk, in replay, and in the standing-lines check. A formatter that rewrote a CRLF file as LF (prettier and biome write LF by default) edits only the lines changed by content, and other sessions' lines in that file stay theirs.

## What goes away

In one change, with no second form beside it ([[acb620dd|no legacy]]):
- the `produces` parameter on `bash`, its preparation and recheck (`packages/agent-tools/src/outputs.ts`, `subject.ts`, parts of `bash/preflight.ts`, `bash/tool.ts`, `bash/managed.ts`, `bash/local.ts`), the `declared-subject-changed` refusal;
- the `path-held` refusal in `import_output` (`importFile.ts`): someone else’s lines stay someone else’s by point 9; the expected-base check stays;
- the doctrine line about `produces` (`native-harness/doctrine/typedTools.ts`) and the answer phrases "recorded against nobody … declares them in `produces`" and "size moves of these files are recorded against nobody" (`bash/answers.ts`);
- **the observation road** — its only source is `ShellRun.report`, and after this spec it is gone; the queue `ObservationQueue` stays and becomes the queue recording command edits:
  - `report` and `observed` in `ShellRun`, the shell branch in `ChangeLog` (`record/write.ts`);
  - `record/observations.ts`;
  - `observed`-kind holders (`record/holding.ts`);
  - shell lines in evidence, attribution, replay, and frontier (`basedOnCommand`, `commandBase`, `movedByCommand`);
  - reading `observed` in `read_changes` and lines about it in the voice doctrine;
  - updating observations in `adoptCanonicalRoot`;
  - the `workspace_observation` table — by a drizzle migration.

## Cost

- Snapshots before and after stay as now: ~100 ms each on macOS (one measurement), longer on NTFS. Speeding them up with git itself (`core.fsmonitor`, `core.untrackedCache`) is the [[6ce62961|fsmonitor idea]].
- Going away: two scoped claim reads and the holder walk before launch (~200–560 ms per call with a claim).
- Nothing is added to the command answer path: the write time comes from the stat the snapshot already takes, the decision is an in-memory registry lookup, lines are written by a background queue. The "after" bytes are not read twice. The "before" text of clean paths is one batched git read per queue pass. Diff runs in a worker ([[7a910861|heavy work goes to the worker]]).
- A large shift is written in parts, so as not to hold the write unit other sessions' edits write through.
- The version store already grows without collection, and commands would add about 1,400 moved paths a day — [[$prune]].

## Out of scope

External-CLI Bash on the terminal transport. Reading hooks in Tagma does not take the call id (Claude Code has it — `tool_use_id`, other CLIs unverified), so parallel calls cannot be paired yet, and each call would cost another +200 ms of snapshots blocking the CLI. Claude through the Tagma runner already calls Tagma's `bash` and falls under this spec. First measure how often an external CLI launches its own Bash.

## Done when

- no `produces` in code, schemas, or doctrine, no `workspace_observation` table;
- a step that writes a file through `write` and immediately runs a script executes, and both edits are recorded without double counting;
- a command made v0→v1, then an `edit` in the same window made v1→v2: both edits recorded;
- a command that generated a WebP and a `perl -pi` loop over 40 files land with `submit_work` without a single manual edit;
- a command over a file where another session holds lines: its own lands, the someone else’s lines stay someone else’s;
- B runs tests 60 s straight, A runs a 3 s script rewriting 300 files: all 300 recorded on A, none on B, wherever the tests start and end;
- `submit_work` of A right after the script lands all its files while B's test still runs;
- `bash` answer time on a command that changed nothing is no higher than before the change;
- commit, `git checkout -- <path>`, and `stash` inside a command window record no edits;
- on Windows with `core.autocrlf=true`, a command that changed one line of a CRLF file yields a one-line hunk, and turn rollback restores the file byte for byte;
- a file held by another process during the snapshot is named in the answer, and the remaining paths are recorded;
- on Windows with `core.autocrlf=true`, a formatter that rewrote a CRLF file as LF and changed one line yields a one-line edit, and another session's lines in that file stay theirs.
