---
id: 01a14da4-e477-7ec2-b31a-eb74c404f4ca
title: "Command roles and \"writers beat readers\": line facts in agent-tools, the starter list, named and implicit exits, the decision with roles, the role in the command journal, the cookie filter, decision telemetry; the retro run first"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14d6a-a561-7869-a9fa-49cfe8cacd0e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14d98-e0c1-7622-a276-d30446bb0015
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/lives.ts
  - kind: file
    ref: packages/agent-tools/src/shellShapes.ts
---
Command roles and "writers beat readers": line facts in agent-tools, the starter list, named and implicit exits, the decision with roles, the role in the command journal, the cookie filter, decision telemetry; the retro run first.

Step 1 of the spec's [[46bb0015]] order: items 1, 3, 6, switching rollback to the window, the `command_window` columns, the `.watch-cookie-*` filter in `porcelainListing`. First comes acceptance 1 (a retro run over the October 11–18 history, the fact classifier + list; learning replays in time), its result in this task before the decision code. Proof is the spec's acceptances 1, 2, 6.

## Retro run (acceptance 1), 2026-10-18 ~06:50 UTC

The classifier is the line facts as they entered the code (`agent-tools/shellFacts.ts`) plus the starter list in `agent-tools/shellReaders.ts`, with role assembly (`change-record/record/roles.ts`). On the operator's word the list is widened past the spec's list to the mainstream popular stack:
- JS/TS: bun, vitest, jest, mocha, ava, tap, playwright, cypress, `node --test`, deno; `tsc`/`vue-tsc --noEmit`, svelte-check, `astro check`; eslint, oxlint, biome, `prettier`/`oxfmt --check`, stylelint;
- `npm|pnpm|yarn|bun run` scripts with a trailing name segment of `test`, `typecheck`, `lint`, `check`;
- Python: pytest, unittest, mypy, pyright, ruff, flake8, pylint, `black`/`isort --check`;
- Go: `go test`/`vet`, golangci-lint, staticcheck, `gofmt -l`; Rust: `cargo test`/`check`/`clippy`/`nextest`, `cargo fmt --check`; Swift: `swift test`, swiftlint, swift-format, `xcodebuild test`;
- JVM, Ruby, PHP, .NET, Elixir, C/C++, shellcheck, terraform;
- wrappers `npx`, `bunx`, `pnpm exec`, `uv run`, `poetry run`, `bundle exec`, `python -m`.

Formatters and fixers with operands are writers of the named paths; package installs, writing git subcommands and `cargo build` are writers without a signature.

History: runlith `bash` commands from 2026-10-11 to 2026-10-18 (`command.measurement`), durations from thread rollouts, `workspace_change` lines (write/delete), typed `write/edit/delete/rename/import_output/strip_comments` calls from rollouts — the latter explain "own" edits. Learning replays in command-end time; the key is repository plus signature; `READER_RUNS=5`, `WRITER_HITS=2`. One sample, the script in thread 01a14d6a's scratch.

**Share of resolved nobody's lines** — main slice 06:25 UTC: 32,737 nobody's lines, all `overlap`. At 72.4% the mtime overlaps ≥ 2 threads (the analyzable part); at 24.1% the last record resolves to one thread while overlap happened earlier; at 3.5% no registry member lived at record time.
- list only: **44.9%** of all, 59.6% of analyzable (set-based cutoff — 4,578 lines, writers-beat-readers — 10,122); with the spec's list it was 33.4%;
- list + learning: **45.2%** of all, 60.1% of analyzable;
- `READER_RUNS=3` gives the same; `READER_RUNS=10` — 15.6%: with a ring of 10 runs two phantom records of outside writers (below) turn `bun test` into a writer;
- next to the classifier's 41.2% in [[dab1641f]]: the spec counts a shell loop the parser never parses (`for f in …; do bun test …; done` — a common form) as a writer.

**Clean runs of commands longer than 60 s:** 586 of 951 (**61.6%**). Clean means `moved = 0`, or with no `overlap`/`unclaimed` and no unexplained record line in the window from a typed call or the command's own set. In total 19,589 provably-reading commands with duration and summary; of those 17,641 clean, 31 records, 1,917 neutral.

**List records learning turned into writers:** one — a path call `…/typescript-native/bin/tsc` (worktree `tagma-holder-impl`) with two records of `ExecutionCapacity.test.ts` on 2026-10-11 07:54 and 08:02. Both sit in lines of `oxfmt <directory> && tsc …`: the record lies outside the `oxfmt` set, and `tsc` is the only part without a set. That is how the spec works: authorship between parts is indistinguishable, and the single part without a set is charged. Learning made 169 signatures readers, among them `bun run vitest`, `tsc` by path, `bun checks/law/program.ts`, `curl`, `sqlite3`, `sed` without `-i`.

**An error the run found and the facts fixed:** counting clean runs for every part makes learning turn `cp`, `ln`, `rm`, `mkdir`, `git add/checkout/merge`, `cargo build`, `bun install`, `oxfmt` into readers — their runs often shift nothing in tracked paths (a record outside the checkout or into ignored paths, a repeated format, `git checkout -- p` returning the path to HEAD). Such a "learned" role would hand their record to a neighbouring writer. So:
- `rm/rmdir/mkdir/touch/truncate` are writers of the named paths by operands; `cp/mv/ln/install/rsync/ditto` by target (`mv` also by sources);
- `chmod/chown/tar/unzip/patch/dd`, writing git subcommands, package installs, `cargo build/run/…` are writers without a signature, i.e. never learn;
- `git add` is a writer of the empty set: it only touches the index;
- a clean run, like a record, only counts toward parts without their own path set.

**Single-reader record rate (list only):** 5 of 8,026 reader commands (**0.06%**), and not one is that reader's own record. Twice — temporary `.merge_file_*` at the checkout root (old records before the filter in `porcelainListing`). Three times — an outside writer's record: server files during `bun test` or `bun run typecheck` in `packages/agent`. `RUNLITH_TEST_REPORT=1 bun test` is now a writer by flag exception.

**What the run never establishes:**
- a reader's record next to a living writer of another thread: today it goes to overlap and never enters this rate;
- the "clean run" accuracy by summary: runs with `unclaimed` are named neutral, although some such shifts are explained by nobody's reshape marks.

## Handover, commit 5d35ec0711

The resolved-share numbers above are a rerun after review fixes. Unproven:
- the `.watch-cookie-*` filter in `porcelainListing` arrived with the watch-parcel commit ad30e657, not this one;
- telemetry of item 6 — a `CommandDecision.<basis>` span on every counted shift; no read_changes summaries by reason;
- acceptance 6 (tagma:try under agent load) is not done;
- acceptance 2 is covered by `lives.test.ts` unit tests; team cases are step 3 ([[0459f2fb]]), learning is [[621cc688]].
