---
id: 01a16ac4-44bf-7e0a-8178-b70405af9265
title: "Single-command change check: only the tests the change reaches, and cached results by input hash"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: AGENTS.md
---
**Today.** The root `AGENTS.md` Validation section tells the author to run the package's `test` — the unit layer; integration and system are not named there at all. `submit_work` runs no tests, CI (`.github/workflows/test.yml`) only runs by hand. An agent for whom it is expensive checks less, and whatever broke outside its selection stays red until someone's full run.

**One change-check command.** The root script runs the unit and integration tests the change reaches relative to the base (default HEAD, a branch's base for branches), with a results cache, and prints what ran, what came from cache, and why. The Validation section in `AGENTS.md` is rewritten onto it by the same work.

**The change.** Inside a Tagma session the change is the lines it holds in the checkout (the change record); outside a session and in CI it is the diff against the branch base; `--commit`, `--base`, and `--paths-from` name it explicitly.

**Selection.** `bun test --changed=<ref>` misses workspace packages and computed paths ([[fd75347c|probe]]), so the selection builds on its own runtime-import graph: lazy `import()` calls are edges, type-only imports are not, `import.meta.glob` expands over the tree. A computed `import()` is closed by that test's run trace or the package's `changeCheck.loads` declaration ([[504fa5da]]). Module cards play no part in selection.

Import-graph selection need not be narrow: `composition/runtime.ts` statically imports 197 modules, and nearly any server change reaches files with the runtime world and the graph world — the most expensive ones. Selection narrowness is measured on the sample below; without it this delivery's win is the cache, and [[ff15f336]] and [[14455f40]] make each file cheap.

**Input-hash cache.** The key is a coarse unit, to never give a false green:
- the sources the file's imports reach, including `import()`;
- every file of the test's package that is not TS sources, and its fixtures — what is read via `import.meta.dir`/`import.meta.url` (138 integration and system files touch them);
- the lockfile, the Bun, git, and cargo versions, the kit preload, migrations, native artifacts (`sqlite.native`, the watch library, the execution host binary);
- the seed and the adapter kind: a selective run on real variants ([[168725a4]]) does not eat the cache.

A file reading anything else outside this is marked uncacheable. The environment is isolated by the kit ([[3e26831e]]): HOME, git config, TMPDIR, a closed network. The cache sits at the machine and is shared by its worktrees.

**In-run order.** `--timings` with `--update-timings`: the slowest files go first and split by time.

**Acceptance.**

The command delivered; the wall/CPU comparison on the pre-recorded sample stays with the shared quiet window by the lead's order. The 20× goal so far unconfirmed; the sample membership, current-tree check bounds, and commands live in [[2809e291|measurement note]].

- A no-change repeat launches not one test file.
- A source edit in a lower server module (e.g. `platform`) restarts every test file whose import graph, `import()` included, reaches it.
- The sample is the history's last ten commits, each in one–two modules, the list recorded under this spec before the measurement. On it the change check compares against the full run of the touched packages' layers; the goal is 20× cheaper in wall and CPU.
- No test the sample commit itself turned red in the full run is skipped by the change check; tests red before the commit do not count.
