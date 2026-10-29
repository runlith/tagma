---
id: 01a14d98-e0c1-7622-a276-d30446bb0015
title: "Attributing command edits without root: reader/writer roles from the starter list and repo history, named and implicit outputs, team attribution, snapshots off the watcher cursor with a delivery barrier"
ord: 53
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10323-2fc7-78fa-8d6d-620a6ce62961
  - kind: relates
    to: 01a111ab-9639-7730-81d5-593018d06fb3
  - kind: relates
    to: 01a116e8-e341-7861-a5f6-564c65835438
  - kind: relates
    to: 01a14c8b-1ab3-729f-bb5e-5a7de611425d
  - kind: relates
    to: 01a14d8a-0f78-73df-81be-ec30dab1641f
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/commands.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/lives.ts
  - kind: file
    ref: packages/agent-tools/src/CheckoutBaselines.ts
  - kind: file
    ref: packages/agent-tools/src/ShellRun.ts
  - kind: file
    ref: packages/agent-tools/src/shellShapes.ts
---
Edits an agent command made in the shared checkout usually find their author, and the command wrapper costs tens of milliseconds, not hundreds. No root, no injection into others' processes, no sandboxes; the same for every language and project. Wrong attribution is worse than an unattributed edit: every rule below attributes an edit only when it can justify it, otherwise leaves it unattributed.

## Now

**How authorship is decided** (`change-record/record/lives.ts#Lives.decider`, contract — [[65835438]]). Candidates are the lives of commands that touched the file-write moment (mtime ± `WRITE_GAP_MS`), or — with no moment — the command window. Candidates count by threads: one thread — its edit, several — `overlap`, the edit unattributed. If the moment is known but no life touched it, the decider falls back to the deciding command's window lives (`lives.ts`, lines 173–174). Commands whose line provably only reads (`agent-tools/shellShapes.ts#shellReadsOnly`) open a life via `Lives.reading`: they are not candidates and have no journal window.

**How many unattributed** (main runlith slice 2026-10-18 ~05:25 UTC, [[dab1641f]], one sample at ~10 parallel agents): 32,802 unattributed lines against 15,219 owned, all `overlap`. The typical window is one agent's short writer (`oxfmt --write …`, a script, `perl -pi`) inside minutes-long `bun test` / `bun check` of two or three others. All candidates from one agent team — 9% of unattributed lines (same hour's measurement).

**What the wrapper costs** (telemetry, ~12,950 `bash` calls over 36 h): `ShellRun.open` averages 175 ms, `ShellRun.finish` 135 ms; the main part of both is `CheckoutBaselines.checkoutState`, a full `git status` and dirty-path digest, ~111 ms per snapshot. About 310 ms per `bash`. Runlith enables `core.fsmonitor` and `core.untrackedcache`, but snapshots run with `--no-optional-locks`, so the refreshed index and fsmonitor token apparently never persist (inference, not measurement).

**Rejected by research** ([[dab1641f]], probes on this Mac): Seatbelt (`sandbox-exec`) — a nested sandbox breaks Claude Code, Codex, `swift build`, Chromium; `DYLD_INSERT_LIBRARIES` interception — system `sh`/`zsh`/`bash`/`env` scrub it, coverage tears on `/bin/sh`, `sed`, `git`, `bun run`, +8 ms per process start, gain ≤ +21 pp; process write counters — writes of exited children are lost; open-fd polling — catches 1.2% of writes; Endpoint Security — needs Apple approval. A worktree per agent is no fix: the same 5–10 agents work in one worktree.

## Decision

### 1. Command-line facts (kit) and command role (change record)

**The `agent-tools` kit (`shellFacts.ts`) yields facts about every part from the line text**, knowing nothing of the server:
- `readsOnly` — the part provably only reads (current `shellReadsOnly`);
- `named` — paths the part changes: literal arguments of known mutating programs (`sed -i`, `perl -pi`, `oxfmt|prettier|biome --write`, `eslint --fix`, `ruff --fix`) and file redirect (`> f`, `>> f`, `tee f`). Paths resolve from cwd honoring `cd` in the line. A directory argument means its subtree. A glob argument (even quoted, one the shell never expanded) makes the part an unnamed writer. Side outputs join the set: backup suffixes (`-i.bak`, `-pi.orig`), cache (`.eslintcache` with `--cache`);
- `signature` — the program (basename) and first subcommand word, not a flag or path; for `npm|pnpm|yarn|bun run <script>` — also the script name; for an interpreter launching a file (`bun x.ts`, `node x.js`, `python3 x.py`, `sh x.sh`, `./x`) — the script path from the checkout root. Inline code (`-c`, `-e`, heredoc into an interpreter) has no signature. `env`, `time`, `nice`, `timeout` prefixes and assignments are stripped (`withoutPrefixes`);
- `listed` — a starter-list entry (below), if the signature is in it and its exclusion flag never fired;
- `implicit` — a list entry's implicit outputs: `__snapshots__/` and `*.snap` on test runners (new snapshots write even without `-u`), `Cargo.lock` on `cargo`, `Package.resolved` on `swift`;
- an unrecognized part (`shellCommands` → `null`, `eval`, command substitutions, shell functions and loops the parser never parses) — a writer.

**The starter list** is data in `agent-tools/shellReaders.ts`: check actions of the mainstream popular stack, readers by shape, each entry with a program, subcommand, required flag, its own exclusion flags and implicit outputs. Tests, typecheck and lint without fixing for JS/TS (bun, vitest, jest, mocha, playwright, cypress, `node --test`, deno, `tsc`/`vue-tsc --noEmit`, svelte-check, eslint, oxlint, biome, `prettier`/`oxfmt --check`, stylelint), Python (pytest, unittest, mypy, pyright, ruff, flake8, pylint, `black`/`isort --check`), Go, Rust, Swift, JVM, Ruby, PHP, .NET, Elixir, C/C++, shellcheck, terraform; `npm|pnpm|yarn|bun run` scripts whose last name segment is `test`, `typecheck`, `lint`, `check`. Wrappers (`npx`, `bunx`, `pnpm exec`, `uv run`, `poetry run`, `bundle exec`, `python -m`) are stripped. Shared exclusion flags making an entry a writer: `-u`, `--update-snapshots`, `--updateSnapshot`, `--fix`, `--write`, `-w`, `--emit`, `--autocorrect`, and environment variables with an output path (`*_REPORT=`, `*_OUTPUT=`). Explicitly long-reading commands: headless browsers (their `--user-data-dir` is a named output), `xcrun notarytool`, `curl` without `-O` (`-o` is a named output); output outside the checkout alone never makes a writer. Programs that mutate files by nature are never learned: `rm/mkdir/touch` are writers of named paths by operands, `cp/mv/ln` by destination, mutating git subcommands, package installs, `cargo build`, a formatter or fixer with a glob argument are signatureless writers, `git add` is a writer of the empty set; otherwise their shiftless runs (a write outside the checkout, repeat formatting) would have taught them as readers (the retro run in [[c404f4ca]]).

**The change record assembles the command role** from kit facts and learned roles (§2):
- **proven reader** — every part `readsOnly`; as now, `Lives.reading`, not a candidate;
- **assumed reader** — every part `readsOnly`, a list reader or a learned reader; its implicit-output set is the `implicit` union;
- **named-path writer** — some parts have `named`, the rest are readers; the set is the `named` and `implicit` union;
- **writer** — everything else. This is the current behavior.

An assumed reader and a named-path writer open a life via `Lives.open` (they are candidates with a journal window). The role, path set, part signatures and command id are stored in `Life` and in `command_window` (new `ADD COLUMN … NULL` columns, [[d81b1676]]): post-restart verdicts and re-verdicts from the row queue (`commandRows.ts`) see the same role as at open. The role is computed at life open, before process start (7–12 µs, measured [[dab1641f]]).

### 2. Learned roles

The change record keeps, per signature per repo (keyed by repo; worktrees of one repo learn together):
- **a write** — the command was the write's sole candidate **at the command level** (not the thread), an unignored path's shift was verdict on it, and the path is unexplained by its named- and implicit-output set. Writes explained by marks (`instant`, `unowned`) are not its: that is how [[dab1641f]] discarded 398 of 414 phantom reader writes. A write counts toward a signature only if the line holds one part with no path set: in `oxfmt --write a.ts && bun check` the `a.ts` write is explained by the set, while an off-set write never counts toward `bun check`, because authorship between parts is indistinguishable;
- **a clean run** — no unignored path shifted in the command window without a mark or path-set explanation. A strict definition: under high parallelism a long command struggles to collect clean runs, deliberately so — the starter list covers frequent checks.

Rules:
- an off-list signature becomes a reader after `READER_RUNS` consecutive clean runs with no write; a run that is neither clean nor a write neither breaks nor advances the streak. Initial value — 5; the retro run justifies the number (acceptance 1);
- a signature becomes a writer after `WRITER_HITS` writes over its last `READER_RUNS` runs; initial value — 2, not 1: among single-reader windows 13 of 414 (3%) are off-registry writes (an editor, an external CLI, a merge), and one such write must never make a check a writer forever. A list entry becomes a writer the same way. A learned role holds while the ring confirms it: a writer returns to its fact role when writes in the last `READER_RUNS` runs drop below `WRITER_HITS`;
- a learned role applies from the next command: the lesson is written by a queue off the command path, and the next command's open awaits already-queued lessons;
- only the live window verdict learns, including a run with not a single shift; a post-restart re-verdict never learns, because neighbors' lives with closed windows are lost and “sole candidate” is false there;
- a script outside the checkout gets no signature; a part made a writer by an exclusion flag, an unmet required flag, an unrecognized program's redirect or an unresolvable output never learns either.

Storage is a change-record table in the machine database (declared in the manifest, migrated per [[d81b1676]]): repo, signature, clean-run counter since the last write, the result ring of the last `READER_RUNS` runs, last write's time and path.

### 3. Verdict with roles

`Lives.decider` gets every life's role, path set and command id. For a path shift unexplained by marks:
1. **candidates** — lives that touched the write moment. If the moment is known but no life touched it, the shift is `unclaimed`, not a window fallback: this changes the current code. With no moment (`mv` assignments, writes with preserved mtime, chain transitions in `commandRows.ts`), candidates are the window-touching lives, as now;
2. **set filtering** — only with more than one candidate: a named-path writer whose set lacks the path drops out; an assumed reader whose implicit set holds the path stays as that path's writer;
3. **writers beat readers** — if a writer or named-path writer remains, assumed readers drop out; the rule applies only to a write with a known moment inside the remaining writer's life;
4. one thread — its edit; several threads, all one agent team — unattributed with the `team` cause (§4); otherwise — `overlap`.

The sole candidate, whoever it is, takes the edit itself: so `RUNLITH_TEST_REPORT=1 bun test`, having created a file, authors that file, and its signature gets a write.

**Cost of error.** Rule 3 errs when an assumed reader wrote while another thread's writer lived: its edit goes to the writer. That rate is unmeasured — such cases currently land in `overlap`. Indirectly: among windows where a reader was the sole candidate, a genuine reader write is 1 in 4,501 reader commands, bound 16 / 4,501 (0.36%) ([[dab1641f]]); the learned role drops reader status after `WRITER_HITS` writes.

### 4. Team attribution

If every remaining candidate is a thread of one thread tree, the shift is unattributed with the `team` cause and the tree root (`command_unattributed`, reason `team`, root id). The change record reads the tree root (`spawn_root_id`) at command open from the thread-record contract (`ThreadRecords`), which it already depends on, and keeps it in the window (`command_window.team`) and in the observation (`command_unattributed.team`); no separate port needed. Such a path:
- `read_changes` names “team <root>”, not “unattributed”;
- is landed by the tree root's own `submit_work` with `taking` of any of these children, or by any session via `paths`, like any unattributed path. With neither `paths` nor `taking` nobody takes it: otherwise an agent would commit a neighbor's unfinished edit;
- it never becomes the lines' holder: which agent wrote is unknown.

An operator driving everything from one home thread gets one team over all their agents: then `team` honestly says “this is my agents' work”, and they land it themselves via `taking`.

### 5. Snapshots around `bash` via the watcher process cursor

The watcher process ([[e611425d]]) keeps a cursor change journal for the root; graph-tree freshness already reads it (`FileWatcher.mark` / `changedSince`, [[ec0b8911]], [[94d69020]]). Command snapshots build on the same journal, and their contract never changes: a command sees the same shifts a full `git status` would give.

- **Owner.** `CheckoutFrontier` and snapshots stay in the kit (`CheckoutBaselines`, `CheckoutFlights`). The kit declares a change-source port `{ mark(root), changedSince(root, position) }`, and composition fills it with `FileWatcher`. Without the port the kit takes a full snapshot. There is no new dirty-status output: the frontier never updates per event, it catches up its cursor at each snapshot.
- **Subscription.** The port holds the checkout-root subscription while at least one command runs in it, plus `LINGER` after the last — never relying on the `CheckoutRows` subscription, which closes with no viewers. The first command in a subscriptionless root takes a full snapshot and opens it.
- **“Before”** is cursor and HEAD; the frontier catches up the cursor: digest and held text recompute only for paths changed since the frontier's last cursor.
- **“After”** is the **delivery barrier**: the kit writes a cookie into the root and awaits it in the change journal (the same mechanism as `settledSince`), so the command's last writes never slide into the next window. Then the post-cursor paths; over them — `git status` with a literal pathspec (`@runlith/git` `pathspecFits`/`mergeScoped`, as in [[94d69020]]): so a path gone clean leaves the state, an ignored one never enters, and a deleted or moved directory reads as a subtree. `.git/*` paths filter out of the shifts.
- **HEAD and index.** A window HEAD shift is the old-vs-new HEAD diff paths; an index shift is judged by content (`git diff-index --cached` against the past), never by `.git/index` stat, which any neighbor's `git status` rewrites. A linked worktree's git directory sits outside the root, so HEAD and index are read by git, not the watcher.
- **A full snapshot, as now,** on cursor loss (`changedSince` → `null`, epoch change at subscription reopen, watcher process loss), if post-cursor paths overflow the command-line limit, and on ignore-rule change: any `.gitignore` among the paths (nested included), `.gitignore` of directories above the tree, `info/exclude`, shared git directory `config`, `core.excludesFile` — by stat, as in [[94d69020]].
- Cookies `.watch-cookie-*` also filter in `porcelainListing`: now a full snapshot coinciding with a cookie would show it as a shift (as `.merge_file_*` once did).
- **Write moment.** The process adds the event-arrival moment to the change. It replaces mtime only where mtime never changes (`mv`/`git mv` assignments, `cp -p`, `touch -d`), and only as an interval — “event arrival minus delivery latency” (`LATENCY` of FSEvents plus the cross-process hop) — never a point. Off-window mtime is true evidence of a pre-window write, and no event replaces it. The record keeps one change per path, so several same-path writes in one window are never judged separately.

Goal: p50 `ShellRun.open` + `finish` on a changeless command ≤ 60 ms (the barrier costs up to one FSEvents latency interval, 50 ms, at the edge), p95 no worse than now under load; the “after” of a script that changed 300 files no slower than now.

### 6. Metrics

Holdings, the “whose lines stand” verdict owner ([[3eec0704]]), returns a summary in the `read_changes` answer with `path`: owned lines and unattributed ones by cause (`overlap`, `team`, `restart`). The change record logs every shift's verdict to telemetry: what decided it — the sole candidate, set filtering, the “writers beat readers” rule, the agent team, or `overlap`. The meaning of `read_changes` without `path` never changes.

## Layers

- `agent-tools/shellFacts.ts` — line-part facts: `readsOnly`, `named`, `signature`, `listed`, `implicit` (the type lives in the `WorkspaceChanges.ts` port); `shellReaders.ts` — the starter list as data. Pure functions.
- `agent-tools/CheckoutBaselines.ts`, `CheckoutFlights.ts`, `ShellRun.ts` — the change-source port, command-lifetime subscription, barrier, cursor snapshots; line facts — at life open (`WorkspaceChanges.command`).
- `change-record/record/lives.ts` — role, set, command id in `Life`; §§3–4 rules; the window fallback is gone.
- `change-record/record/commands.ts`, `commandRows.ts`, `recovery.ts` — role assembly, `command_window` columns, learned-role accounting (idempotent per window), the `team` cause, verdict telemetry.
- Holdings — the by-cause summary.
- `packages/watch` — the event moment in the root change record.
- composition — the change-source port ← `FileWatcher`.

## Rejected

- Seatbelt, `DYLD_INSERT_LIBRARIES`, write counters, fd polling, Endpoint Security, a worktree per agent — the “Now” section, numbers in [[dab1641f]].
- **List only, no learning** — covers no foreign ecosystems and never fixes its own mistakes.
- **Learning only, no list** — in a new project and under high parallelism long checks collect almost no clean runs.
- **Giving the agent-team edit to the root as holder** and taking it with `submit_work` sans `paths` — a holder that never wrote is a lie, and the default pick would carry off a neighbor's unfinished edit.
- **Server-side event-updated frontier** — a third dirty-status output next to `CheckoutRows` and the graph freshness gate ([[51c66b6]]).
- **Skipping “after” on readers** — then nobody would ever see a reader's write.

## Order

1. Line facts, roles, the starter list and roled verdicts (§§1, 3), the window-fallback change, `command_window` columns, the cookie filter, verdict telemetry (§6).
2. Learned roles (§2).
3. Agent team (§4).
4. Cursor snapshots (§5) — independent of 1–3, may run parallel.

## Acceptance — the performer verifies

1. **Pre-code retro run.** The classifier (kit facts + list + learning, replayed over time) runs over runlith history 2026-10-11 – 2026-10-18 (`command.measurement`, `workspace_change`, rollouts, as in [[dab1641f]]). Due: the unattributed-line share the rules would have resolved — list-only and list-plus-learning; the clean-run share of commands over 60 s; how many list entries learning promoted to writers and for what; the sole-reader write rate.
2. **Rule unit tests** (`lives.test.ts`): writer + two readers → writer; two writers of different trees → `overlap`; two writers of one tree → `team`; a named-path writer never takes an off-set path with another candidate around, and takes it when sole; a reader's implicit output (`.snap`) is its; a known moment no life touched → `unclaimed`; no moment — by window.
3. **Integration** (`*.itest.ts`, [[ad3c527d]]): the learned-role table — `READER_RUNS` clean runs → reader, `WRITER_HITS` writes → writer, a composite line never teaches its unnamed part, post-restart re-verdict never double-counts; the role survives restart (a settled window verdicts with the same role).
4. **Cursor snapshots** yield the same shifts as a full snapshot — with and without the port:
   - scenarios [[18d06fb3]] (a `write` record and a script in one step; v0→v1 by command and v1→v2 by `edit`; commit, `git checkout -- <path>`, `stash` inside the window; a 300-file script beside a neighbor's long tests);
   - a write in the last milliseconds before command exit; a neighbor's write just before open (never the command's);
   - `rm -rf` and `mv` of a directory with tracked files; editing a nested `.gitignore`;
   - index only: `git add`, `git rm --cached`, `update-index --skip-worktree`; a neighbor's `git status` in the window triggers no full snapshot;
   - epoch change (first `node_modules`) and mid-window watcher process loss → full snapshot;
   - a linked worktree with its git directory outside the root; Linux in Docker (inotify, `marking: close`).
5. **Speed** on one's own `tagma:try`: p50 and p95 of `ShellRun.open` + `finish` on a changeless command and on a 300-file-changing script, before and after, idle and under several agents.
6. **Metrics:** the §6 summary and verdict telemetry on `tagma:try` under several agents — shares before and after steps 1–3.

## Operator checks

Not a closing condition: after a server restart on main the unattributed-line share sits visibly below today's ~66%, and the `bash` answer on a short command is faster.
