---
id: 01a112cb-2f89-7056-bf19-2c0fd3e50475
title: "Commit steps: a team declares how Tagma brings its commits into shape, and the team's hooks run outside the shared working tree"
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/discharge.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/commit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/land/hooks.ts
  - kind: file
    ref: apps/tagma/server/src/landing/merge/modes.ts
---
Written for Tagma as a product: thousands of teams, any languages, each with its own view of code shape. Tagma brings no view of its own: it executes what the team declared, where ordinary means break — in a checkout that several agents and a person write into at once.

## Who it serves and what they get

- **Teams whose shape is held by an editor or CI** (format-on-save, `gofmt -l`, `cargo fmt --check`, `ruff format --check`, `prettier --check` in CI). An agent has no format-on-save, so its commits fail CI. Commit steps are its format-on-save at commit time: the team declares "on commit run oxfmt over changed TS/Svelte/JSON", and every Tagma commit (`submit_work`, `commit_checkout`) lands in this shape.
- **Teams with hooks** (husky + lint-staged, pre-commit, lefthook) get their hooks executed on Tagma commits without harming others' uncommitted work. They need no steps to declare: their hook already formats.
- **Teams with no formatter** notice nothing. No declaration — Tagma changes not a byte.
- Nobody's uncommitted work is touched: the commit version is reshaped (HEAD + the session's lines), while working files receive only the reshaping delta, and only where it applies without conflict.
- Law separately and on request. No `#rule` is needed to format, and steps reach no prompts. Once steps are declared, the landing doctrine gains one line (like `writing.comments`): the landing may rewrite files by the project's steps, its answer names them, and editing such a file starts with a fresh read.

## What stands now (verified by reading code, 2026-10-06)

1. A tool runs on commit two ways: enforcement rules (`#rule` with an inspection, check only) and the team's git hooks. Inspection adapters (`apps/tagma/inspection/src/runners/*`) only check and are pinned to versions (`ESLINT_VERSION`, `OXLINT_VERSION`, `RUFF_VERSION`…), to their own config and scratch layout (`--no-fix`, `--no-respect-gitignore`); the `runners.json` manifest is found through the project setting `enforcement.programs`, which is a machine-DB row (`settings/store/rows.ts`), not a repository file.
2. Parts 1–4 are built (branch `commit-steps`); part 3 is the `CommitShape` port in `prepare`, the `commit-steps` module, the `commit-step-*` refusals, `withoutSteps`, the doctrine line, the edit-door hint, and display in settings. Hooks of `submit_work`, `commit_checkout`, the `pull_checkout` merge-commit and `merge_worktree` run in the commit tree (`workspace/checkouts/commitTrees.ts`); every Tagma commit creates `makeCommit` in `landing/land/publish.ts` with the user's identity and signature, as `git commit` does, and a signature that fails refuses `commit-unsigned`; `pull_checkout` computes the diverging merge via `merge-tree --write-tree` (`land/pullMerge.ts`) and opens no merge in the shared checkout; hook edits, including files it created and deleted, reach the working files through `ChangeRecord.reshape` on any outcome, answers naming them in `edited` and `kept`. Below is the defect this was built for.
   Before them `submit_work` ran `pre-commit`, `prepare-commit-msg`, `commit-msg` in the SHARED working directory with a private index. For a private index "unstaged" is all other sessions' uncommitted work, so:
   - the pre-commit framework (`staged_files_only.py`) saves it as a patch and runs `git checkout -- .` over the whole tree for the duration of all hooks, then `git apply`; on conflict — `checkout -- .` and apply again;
   - lint-staged (`gitWorkflow.js`) does `git restore --worktree` of partially staged files, puts a backup in the shared `refs/stash` (`stash create` + `stash store`), and on any task error (e.g. the formatter failed to parse a file) — `git reset --hard HEAD` over the whole tree and `stash apply`.
   Result: while a hook runs, others' work disappears from disk, another agent's write in that window is lost, and a failed hook hard-resets the shared tree. Concluded from reading both tools' code, not reproduced.
   `commit_checkout` (`git commit` in the shared directory) and the `pull_checkout` merge-commit carried the same defect; `merge_worktree` isolated hooks in a temporary copy without `node_modules`.
3. Textual line discharge (`change-record/record/discharge.ts` `carried`, `standingAt`) stays for landings without reshaping; lines whose file was reshaped are stamped by the commit explicitly.
4. There is no "30 s" landing budget. Landing attempts are bounded by `CEILINGS.callCap` (15 min), the hooks lane also 15 min, the commit lane 60 s. `programCeiling` is declared in `platform/contract/service/deadlines.ts`, but nothing calls it in production, and `ProgramRoad.run` takes no ceiling.
5. Precedents for shape automation already exist, and both are off by default: `writing.comments` (strips added prose comments on write doors and renders a doctrine line) and `worktrees.setupRun`. Both are settings, not repository files.

## Model

- **Commit step** — a team's command that Tagma runs over the commit version and whose result enters the commit. Only reshaping a file into itself: formatting, import sorting, a linter's `--fix`, a file header insert. A step judges nothing; its failure is the act's failure (the commit's shape cannot be had), not a verdict on content.
- **Not a step**: codegen, lockfile regeneration, anything writing other files or needing a build. That stays hooks, CI, or law ("generated is current").
- **Law** — `#rule`, and only on request, to catch commits past Tagma (the Tagma gate hook judges them). One builtin check suffices: "changed files are a fixed point of the declared steps": it reads the same declaration, no tool adapter needed.

## Declaration

`tagma.jsonc` at the repository root. Not under `.tagma/`: `.tagma` paths do not land through `submit_work` (`partitionPaths`), while the declaration changes by ordinary commit. Not a setting: steps reference repository contents (`node_modules/.bin/oxfmt`, `.oxfmtrc.json`), and on a branch where the formatter changes the declaration must change with it; a machine-DB setting travels neither across branches nor to a colleague's machine.

The `tagma.jsonc` of the commit version applies: HEAD + this session's lines for `submit_work`, the index for `commit_checkout`. So a commit is brought to the shape it declares itself: another session's uncommitted edit of `tagma.jsonc` has no effect on someone else's commit, while a commit changing `tagma.jsonc` already passes the new steps. A personal declaration is a `tagma.jsonc` that git ignores (`.git/info/exclude`): it is read from the working tree. An untracked and unignored `tagma.jsonc` outside that commit is someone's uncommitted work and does not apply until committed; project settings name where the effective declaration comes from or why there is none. A new worktree receives the personal declaration only through `worktrees.setupCopy`.

```jsonc
{
  "commit": [
    { "run": ["node_modules/.bin/oxfmt", "--threads=3", "--no-error-on-unmatched-pattern"],
      "files": ["**/*.{ts,tsx,js,mjs,json,css,svelte}", "!archive/**"] },
    { "run": ["cargo", "fmt", "--"], "files": ["crates/**/*.rs"] },
    { "run": ["node_modules/.bin/eslint", "--fix"], "files": ["apps/web/**/*.ts"], "ok": [0, 1] }
  ]
}
```

- `run` — argv. The step's changed files are appended to it, as in lint-staged, so a `lint-staged`/`lefthook`/`pre-commit` entry carries over almost verbatim. Working directory is the commit-tree root. `argv[0]` with a `/` resolves from the tree root, otherwise via `PATH` of the same environment in which Tagma runs project commands. Paths are split into portions by the platform command-line length limit (8191 chars on Windows); one step's portions are independent. On Windows `argv[0]` resolves with `PATHEXT`, and `.cmd` wrappers from `node_modules/.bin` run through `cmd.exe`.
- `files` — globs with `!` exceptions. The tool's own ignore files apply on top.
- `ok` — exit codes meaning "done", `[0]` by default. Needed by fixers that exit 1 when unfixable violations remain (`eslint --fix`, `ruff check --fix`): their remainder is law's business, not the step's.
- Steps run in order, each seeing the previous one's result.
- The declaration has not, and will not without a team that needs it: an adapter name, a config path (the tool finds its own), an act selector, `best-effort`, parallelism.

The declaration is visible in project settings read-only ("Commit steps: `tagma.jsonc`, 2 steps") so the owner finds all shape automation next to `writing.comments`.

## Commit tree

One private working tree per checkout in Tagma storage, created on first need (a `pre-commit`/`pre-merge-commit` hook exists or steps are declared).

- Its own work tree and index; the git dir is the checkout's, as with `candidate` now. Hooks see the team's refs (`origin/main` for nx or turbo affected runs). Cost: lint-staged's backup stash stands in the shared `refs/stash` for the hook's duration, and on success lint-staged drops it. `core.hooksPath` is passed as the checkout's hooks' absolute path.
- Before each use the tree is brought to the commit version by its own index (only differing files rewritten), and untracked unignored files left by the previous run are deleted.
- The checkout's ignored files are visible in the tree as links, unnamed in the core. What git calls ignored (`ls-files --others --ignored --exclude-standard --directory`) links from the tree to the same place in the checkout: a directory by link (a directory junction on Windows), a file by link, and where the platform gives none — by copy. For steps this is done in directories on the path from the root to each changed file (which config and module lookup also walks), so cost grows with the change. For hooks — all ignored, re-read on every run (runlith: 274 entries, 66 of them `node_modules`, 0.33 s; one sample).
- A tool's write through a link, and deletion too, lands in the checkout's ignored files: caches, build artifacts. The same power the same tool has in the checkout itself. Ignored files belong to no session (`partitionPaths` never lands them), so isolation protects tracked files and others' uncommitted lines, but not ignored ones. Tagma itself writes nothing into the checkout's ignored files.
- Materialized through Tagma's own git (without `core.autocrlf`), and hashed back with `cleans`, like `ownBlobs` in `change-record/prepared/tree.ts`.
- Steps and hooks of all three acts use it; the merge's `candidate` is replaced by it. Work with it runs in the checkout's hooks lane, so landing steps, early landing, and `check_rules over: change` wait on each other in it.
- Cost: first creation is a full copy of tracked files (runlith: 24,366 files, 609 MB; one sample), then proportional to change.

## Execution

1. The landing assembles the commit version as now (HEAD + the session's lines) and sets it out in the commit tree. `commit_checkout` takes the commit version from its index and publishes by the same path as `submit_work`: `commit-tree` + `update-ref`, `prepare-commit-msg`/`commit-msg` with the message file, `amend` with HEAD's parents. Porcelain `git commit` would run hooks in the shared directory. Reshaped blobs enter its index too.
2. A step receives the changed files under its `files`, except deleted files, symlinks, gitlinks, binaries, files with the `filter` attribute (an LFS pointer must not be formatted as JSON), and graph storage.
3. A step works in place on these paths; only these files' changes enter the commit tree, hashed with `cleans`. Everything else the tool wrote is discarded.
4. Steps are part of what `prepare` calls the commit version: the change record declares a tree-reshaping port in its contract, the steps module fills it, composition binds. So `check_rules over: change`, early landing (`landing/land/ahead.ts`), and `commitOwn` judge the same tree, and `check_rules`' `refuses` is honest.
5. Order: steps → rules → the team's hooks (in the same tree) → rules again if a hook changed the tree → publication.
6. Change record: the landing stamps with the commit every line it carried, both `own` and `whole`, when a step changed its file. Textual discharge (`carried`, `standingAt`) does not work here: lines in HEAD are already in another shape, and a repeated landing would answer "nothing", leaving the session holding its lines forever.
7. Working files: each step-changed file receives the step's delta by three-way merge (`git merge-file`: base — the pre-step commit version, "theirs" — post, "ours" — bytes on disk), in the file's working form (`workingTextsAt` through `configuredGit`, else a CRLF file conflicts wholesale). Written only if the bytes have not shifted since reading (compare-and-swap via atomic rename). The change record counts the write as committed contents, held by nobody. A file conflicting with others' lines or a shifted file is left alone and named in the answer.
8. The landing answer names reshaped files and files left on disk as they were, with the reason.

## Team hooks

Stay as they are in meaning: this is the team's automation in git's language, Tagma executes it. What changes is the place: `pre-commit` and `pre-merge-commit` run in the commit tree for `submit_work`, `commit_checkout`, and `merge_worktree` (`merge` mode). `prepare-commit-msg` and `commit-msg` work with the message file, and need no tree.

A hook's result carries over as git would have left it in the checkout itself:
- what the hook staged (lint-staged, lefthook with `stage_fixed`) enters the commit: rules judge again, the delta goes to the working files per execution §7;
- what the hook changed without staging enters the working files by three-way merge as this session's uncommitted work. Both on success (lefthook without `stage_fixed`) and on refusal (the pre-commit framework fails a hook that rewrote a file and waits for a repeated commit). The refusal names these files, and a repeated `submit_work` carries them. Otherwise the pre-commit framework's formatting hook would refuse the agent forever: its edits stayed in the commit tree.

The "run in the shared directory and check after" variant does not work: the harm happens during the hook, and no check returns another agent's lost write.

## Failure

- `commit-step-missing` — `argv[0]` missing or not executable. The reason names the step, the path, and the `PATH` searched; in a worktree — also its setup state (`pending`/`running`/`failed`). Unblock: install the project dependencies or fix `tagma.jsonc`.
- `commit-step-failed` — exit code outside `ok`. Reason: the step, the files, and the tool's last stderr lines (oxfmt on a syntax error exits 2 with the error's place). Unblock: fix the file, exclude it in the tool's ignore file or in `files`.
- `commit-step-cut` — the step hit the ceiling. Unblock: fix the step or narrow `files`.
- Nothing is published and working files are untouched. Unformatted never leaves silently, no `best-effort`: otherwise the commit's shape would depend on the machine.
- The operator may make one commit without steps (on the panel — an action next to the refusal, at `submit_work` — on their word); the answer names it, and such a commit passes even with an invalid `tagma.jsonc`.

## Cost

- A step runs as the `commit-step` tool under the command rules naming that tool, and inside the checkout's hooks-lane ceiling in which the commit tree works; a step has no run history of its own.
- No more than three step processes per landing, and a machine-wide pool across concurrent landings.
- All text comparison by git subprocesses (`write-tree`/`diff-tree`, `merge-file`); no diff on the event loop.
- Sample on this machine (one sample): oxfmt 0.72.0 reformatted 1,991 `apps/tagma/server/src` files in under a second with `--threads=3`; one file through stdin — about 48 ms per file. A batched in-place call pays off the commit tree starting at a dozen files.

## Adopting into the project

Not a mechanism but an agent skill (`rules` or skill), only at the owner's request:
- reads what already exists (`.prettierrc`, `biome.json`, `dprint.json`, lint-staged, `.pre-commit-config.yaml`, `lefthook.yml`, `rustfmt.toml`, `ruff.toml`, CI shape checks);
- if shape is already held by hooks — says they execute on Tagma commits, and proposes no steps (two formatters in a row are double price, and different ones an endless rework);
- otherwise proposes a step from an already installed tool and a one-time base commit of the whole declared scope: until a file is in shape, the first edit reformats it wholesale and collides with other sessions' lines in it;
- shows what the base run will change, and writes `tagma.jsonc` on the owner's word.

## runlith

- Tool — oxfmt 0.72.0, `.oxfmtrc.json` with `singleQuote: true`, `svelte` on (without the option `.svelte` passes through oxfmt unchanged with code 0 — silently).
- `printWidth` is chosen with the 650-line rule, not only by smallest diff. Sample on `apps/tagma/server/src` (1,991 files, 210,822 lines; one sample): at 100 — 275,070 lines (+30.5%) and 23 files over 650; at 140 — +8.1% and 4 files; at 180 — −0.7% and 3 files; 1,433–1,712 files change at any width. The rule stands at gate, and debt "may shrink but not grow", so the base commit is refused until over-threshold files are split or the debt is rewritten through `enforce_rule` openly. The rule's other regions (`apps/tagma/app`, `packages/*`) are sampled the same way before choosing.
- Base commit: outside `archive/`, `.tagma/`, `*.generated.ts`, `bench/*/index.html`, `patches/`; run typecheck and tests where fixtures rest on line numbers; add the commit to `.git-blame-ignore-revs`; do it at a moment with no open worktrees carrying uncommitted work.
- `crates/` (Rust): decide explicitly — a `cargo fmt --` step or outside the declaration.
- Declaration — `tagma.jsonc` with the oxfmt step above.
- No "code in oxfmt shape" rule until catching commits past Tagma is needed.

## Outside this spec

- The layout-independent `size` metric is a separate inspection-package spec (`code-facts` currently parses only JS and Python). One thing stays here: on Tagma landings rules judge the post-steps tree, so line gluing unwraps before judgement.
- Steps on `merge_worktree`: its commits already passed steps on their landings; in `rebase` reshaping would break the `replayedTree !== at.tree` check (`merge/modes.ts`), and in `merge`/`squash` it would yield contents no side wrote.
- Steps and hook isolation for human terminal commits through the Tagma gate hook are the next step: the same stash-framework danger to others' uncommitted work stands there too.
- stdin mode.
- Where the other declarations referencing repository contents live. `runners.json` is found through `enforcement.programs`, and `worktrees.setupRun` is a setting; both stand in the machine DB. A separate decision. `tagma.jsonc` holds each subject under its own key (`commit`) to take them in without rebuilding.

## Owners and layers

- **Commit tree — workspace**, tag `CommitTrees` in `workspace/contract/service/commitTrees.ts`. This is the checkout's place, and workspace is the lower module that knows checkouts; both landing and enforcement see it (future isolation of terminal-commit hooks). `within(git, checkout, tree, reach, use)` holds the checkout's hooks lane for the whole call, brings the tree to `tree` by its own index (`read-tree --reset -u`, `clean -fdq` without `-x`), and links the ignored files by `reach` (`all` for hooks, `along` paths for steps); `staged`, `taken`, `unstaged` read the result. The hooks lane moves from landing (`land/lanes.ts`) to workspace. `HookPlace` is replaced by workspace's `TreePlace`; `candidate` in `merge/modes.ts` goes away. Trees of vanished checkouts are removed by workspace's driven cleanup in the same change.
- **`commit_checkout` — landing**, wholly: declaration, body, publication by the path shared with `submit_work` (`commit-tree` + CAS `update-ref`, message hooks with the file, HEAD's parents on amend), the `actChecks` judgement over the post-steps-and-hooks tree. `CheckoutWrites.commit`, `judgeStaged`/`recordTree` and their filler in `composition/callPorts.ts` leave workspace; `@runlith/git`'s `commitAt` is deleted. The operation name does not change. The workspace card stops calling commit its git act.
- **`pull_checkout`** makes the merge-commit with porcelain hooks in the shared directory — the same defect; its `pre-merge-commit` goes into the commit tree in part 1.
- **The `CommitShape` port — change-record**, `contract/service/shape.ts`; `prepare` (`prepared/change.ts`, between `build` and `subjectOf`) calls it, so `check_rules over: change`, `ahead.ts`, and `commitOwn` judge one tree. Without a declaration the port answers the same tree. The `commit-step-*` refusals stand in change-record's wire and enter `PreparedRefusal`. `PreparedBuilt` carries `reshaped`; a change emptied by a step answers `nothing`. Violation attribution (`holdersOf`) leads lines through the step's delta.
- **Steps — a new `commit-steps` module** (product, `apps/tagma/server/src/commit-steps/`): reads `tagma.jsonc`, selects files, runs steps in the commit tree through `ProgramRoad`, fills `CommitShape`; composition binds. Imports platform, workspace, change-record, executions; does not import landing, so enforcement's "steps fixed point" builtin can read the same declaration. The argv limit, `PATHEXT`, and `cmd.exe` are a platform variant and belong to `ProgramRoad`, not steps.
- **Change record**: `PreparedPlan.whole` carries line ids; after publication landing stamps `own` and the `whole`-path lines from `reshaped`. Three-way merge is a `ChangeRecord.reshape(checkout, reshaped, holder, commit?)` member: working form via `workingTextsAt`, `git merge-file` subprocess (`mergeFileAt` in `packages/git`), writing through the existing CAS port `LineWrites`; `holder` is `unheld` (a step's delta or hook-staged, held by nobody) or `held` (what a hook changed past the index, the session's lines). A file created or deleted by the tool carries over while the disk has not diverged. The per-path answer is `merged`, `unrecorded`, or `kept` with a `conflict`, `moved`, `unreadable` reason; a symlink stays as is and is called `link` in the landing answer. A step's file-mode change carries as part of the delta.

## Parts (order)

Parts 1 and 2 land together: without merging, a hook that reformatted a file in the commit tree would leave the working file in the old shape, and `whole` lines held forever.

1. Commit tree in workspace; `submit_work`, `commit_checkout`, `pull_checkout`, and merge hooks execute in it; `commit_checkout` in landing.
2. Change record: stamping every carried line with the commit on reshaping; `reshape`.
3. The `CommitShape` port in `prepare`; the `commit-steps` module with `tagma.jsonc`, refusals, answer fields, the doctrine line, the edit-door hint ("file rewritten by commit `<commit>` (steps or hooks), read again"), display in settings.
4. The agent skill for adopting existing automation.
5. runlith: oxfmt.

## What shows it works

The performer proves with tests through public operations:
- a hook running `git checkout -- .` (pre-commit-framework form) during `submit_work` and `commit_checkout` leaves another session's uncommitted lines on disk byte-for-byte, and the commit does not carry them;
- a step that reformatted a file the session wrote alone: the commit carries the reshaped text, the working file equals HEAD, the session's `read_changes` is empty;
- a step over a file where another session holds lines: the commit carries only this session's lines in reshaped form, others' lines on disk intact, the step's delta applied, held by nobody, the other session's next landing passes;
- the missing, failing, and hung tool yield their refusals; nothing published, disk unchanged;
- a rule judges the post-steps tree: glued lines unwrapped to `size`;
- `check_rules over: change` answers the same tree and verdict as the landing;
- a path under `filter`, a symlink, and a deleted file never reach a step.

The operator checks: a panel commit while agents write; an agent's edit after a reshaped commit; adoption on an external repository (Python with ruff, Go) — that agents do not trip over rewritten files. Not a task-completion condition.
