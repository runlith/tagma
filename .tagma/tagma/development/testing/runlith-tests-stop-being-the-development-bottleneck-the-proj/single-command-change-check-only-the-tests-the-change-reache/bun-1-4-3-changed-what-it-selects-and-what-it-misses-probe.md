---
id: 01a16bdf-4635-793b-87c7-de21fd75347c
title: "Bun 1.4.3 `--changed`: what it selects and what it misses (probe)"
ord: 3
---
Bun version: 1.4.3 (c6da4a4d3). The probe ran on a synthetic git fixture in scratch and on the `apps/tagma/server/src` tree via a dangling base; the real index and working tree never changed, `package.json`, `AGENTS.md`, testbed, and the running server untouched.

**Flags.** `bun test --help`: `--changed=<val>` — "Only run test files affected by changed files according to git. Optionally pass a commit or branch to compare against." No listing-without-running flag (`--list-tests`). The selection shows through `--test-name-pattern ZZZ_NO_SUCH_TEST_ZZZ --reporter=junit --reporter-outfile=<file>`: test bodies never execute, modules and preload load, selected files are `testsuite` in the junit. The exit code in that mode is 1 ("regex matched 0 tests"), only the report reads.

**Ref semantics.** Without a ref — the working tree against HEAD, untracked files included. With a ref — the ref against the working tree, not against the merge-base: on a branch with its own one-file change `--changed=main` selected 8 files because of a change that exists only in `main`; `--changed=<merge-base>` selected 1. The caller must pass the branch base (`git merge-base`).

**Synthetic fixture** (one change per run):
- editing `platform/platform.ts` with no ref → 8 files: a literal import, `require`, a re-export barrel, a literal `import()` in a test body and at the top level, an `import(`…`)` template with no substitution;
- editing `rereading.ts` (test → `mid.ts` → `rereading.ts`) → the test two levels up selected;
- the `../platform/platform.js` and `./../mid/mid.js` specifiers with single quotes → selected; `.js` matches `.ts`;
- the test file itself, an untracked test, and an untracked module imported by a tracked one → selected;
- tsconfig `paths` (`@alias/x` → the package's file) → selected.

Not selected:
- `import type`-only: the type erases, `typesonly.ts` → 0;
- a module with no importers → 0;
- a file the test reads at runtime via `import.meta.url` (not TS) → 0;
- `import()` with `${name}` or a variable as the path → 0;
- a workspace package via a `node_modules` symlink: `@probe/pkg-a/x` (exports `./x`), `@probe/pkg-a/cond` (the `bun` condition → `cond-bun.ts`), `@probe/pkg-a/testing` — editing the target file did not select the test importing that specifier; the same file by relative path selected.

**Real tree** (`apps/tagma/server/src`):
- B0 — a no-edit working-tree snapshot: `88c6251bb7aa3c29b3b702eba81d3bd01dc58a78`;
- B1 — B0 with one extra newline in `platform.ts`: `b24ce637c23b89feb95108afe6deb514f132d1f1`; `git diff --name-only B0 B1` = only `apps/tagma/server/src/platform/platform.ts`;
- `bun test --changed=B0` and `--changed=B1` selected the same 11 files (`Searched 11 files`); an earlier run with B1 selected 3. During the probe other sessions changed the tree (23 files in `apps/tagma/server/src` differed from B0), HEAD moved three times;
- direct importers of `platform.ts`: 3 — `composition/core.ts`, `composition/callLifetimes.ts`, `composition/runtime.ts`, all `'../platform/platform.js'`.

The `platform.ts` edit's contribution in the real tree is not isolated: others' uncommitted edits drive the selection.

**Not established**
- Selecting one change in the real tree: needs a clean tree; no repository copy and no `git stash` were done.
- The reverse closure of `platform.ts` in the real graph: how many tests.
- Workspace packages in the real tree: the server imports `@runlith/*`; exports and condition behaviour checked only on the fixture.
- Vitest packages, other Bun versions, walk bounds on large graphs.
- In `apps/tagma/server/src` `rg` finds 549 occurrences of `import(`, 540 with a string literal; the other 9 unparsed (may be comments).

**Commands.** Fixture: `bun test --changed`, `bun test --changed=<sha> --reporter=junit --reporter-outfile=<file>`; branch: `git checkout -b feat <base>`. Tree: `GIT_INDEX_FILE=<tmp> git read-tree HEAD && GIT_INDEX_FILE=<tmp> git add -A -- . ':(exclude).tagma'`, then `git update-index --cacheinfo 100644,<blob>,apps/tagma/server/src/platform/platform.ts`, `git write-tree`, `git commit-tree -m …`. The temp index lives in scratch. Objects B0 and B1 sit in the object database as dangling. `bun test --changed=<ref> apps/tagma/server/src --test-name-pattern ZZZ_NO_SUCH_TEST_ZZZ`: 68 s wall, 3.9 s user CPU.
