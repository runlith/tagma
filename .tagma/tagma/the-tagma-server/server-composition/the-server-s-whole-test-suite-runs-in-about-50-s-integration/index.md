---
id: 01a0d68a-bb77-75a9-bc81-6742e24637ca
title: "The server's whole test suite runs in about 50 s: integration files hold a processor-time budget, the assembled product moves to a system layer run at merges, and the causes the research measured are fixed"
ord: 33
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d559-16ad-72c3-b569-eb528e7c936b
  - kind: relates
    to: 01a0d4db-9d34-7461-807d-8775f5648cf9
  - kind: relates
    to: 01a0d559-16ad-72c3-b569-eb528e7c936b
sources:
  - kind: file
    ref: apps/tagma/server/package.json
---
The server's whole test suite, unit and integration together, runs in about 50 s of wall time at six workers on an unloaded machine. Every integration file stays under a processor-time budget that only goes down, and the product assembled is tested in a system layer that runs at merges only. The operator asked for this on 2026-09-25. The layers of [[8e7c936b]] made the unit layer fast, but they did not make the whole suite faster.

## 1. Observable outcome

- `bun run test` plus `bun run test:integration` in `apps/tagma/server` together take about 50–60 s of wall time at `--parallel=6` on an unloaded machine, or about 300 s of processor time. The figure is measured and named in the close.
- `*.stest.ts` is the system layer. It is run by `bun run test:system` and at a worktree merge, and never by `bun run test` or `test:integration`.
- An integration file past its processor-time budget is reported by the layer guard as a `budget` violation. It is debt with an owner, or it is new.
- A test author meets the speed law where he writes a test: in a delivered rule, in the guard's refusal line with how to fix it, and in the `ag-no-shit-tests` skill's cost section.

## 2. Problem, with evidence

Measured by research thread 01a0d642 on 2026-09-25, with raw data in its scratch (`REPORT.md`, `master.tsv`). Its figures:
- The whole server suite: about 1400 s of processor time; about 240 s wall at six workers unloaded, about 320 s loaded. 351 integration files, 2932 tests. The unit layer is 1% of it.
- The top 30 files are 38% of the processor time, and the other 321 files are 62%.
- The causes, with the estimated processor-time savings:
  - **The migrated seed database is rebuilt in every file, about 200 s.** `Store.seedDatabase` caches it under `tmpdir()`, and the layer preload gives each file its own `TMPDIR`. That is about 255 files × 0.85 s: 875 ms on a miss, against 25 ms on a hit.
  - **CLI tests start `bun …/cli/main.ts` for every test, about 90 s:** `hookReport`, `hookRecord`, `argv`, `hookFollowup`, `cli/worktree`, `mcpScope`, `hookAdoption`, `mcpDeclaration`, `hookClaims`, `mcpServe`.
  - **Tests of the product assembled sit in integration, about 170 s:** `hostBoot` builds the host bundle and raises real hosts; `worktreeSpawn`, `threadMove`, and the Docker and prepared-tree suites.
  - **Fixed sleeps and polls instead of events, about 100 s of wall time:** `harnessAdoption`, `lanes`, `managedWorld`, `ensureServer`.
  - **git, about 50 s:** `WorktreeFinishing` makes 2319 git calls over 14 tests, and `submitWork` builds a fresh checkout per test.
  - **The tail:** 648 graph tests run through the full stack, with a fixture per test.
- 807 tests were added to the server in the 12 hours of the measurement. Without a budget, the suite grows faster than it is fixed.
- `harnessSession.itest.ts`: 25 failures that depend on order and pass alone, costing 67 s of wall time.

## 3. What holds now

- The layers, the guard, per-test limits (1 s unit, 10 s integration), the unit processor-time budget of 1.5 s per file, `test/failing.json` and `scripts/testLayer.ts` all stand ([[8e7c936b]], closed).
- The graph fixture builds its demo project once per home ([[09744317]], closed).
- No integration budget stands, and no system layer is run anywhere.

## 4. Target model

- **Budgets.**
  - unit: as it stands;
  - integration: a per-file processor-time budget, first figure 8 s (about the p95 of the research's inventory), lowered as the suite is fixed;
  - system: a per-file wall-time budget, first figure measured when the layer lands.

  A file past its budget is a `budget` violation, entered as debt with the task that fixes it as its owner.
- **What an integration test may not do** — the rule the next section writes:
  - sleep for more than 100 ms;
  - wait on a poll with a window above 10 s;
  - start an execution host, the server or the `tagma` CLI per test (once per file is allowed);
  - need Docker;
  - make more than three real git merges per file.

  The guard enforces what it can tell apart at run time, and the budget catches the rest.
- **Fixtures:**
  - a world per file, not per test;
  - a per-test open only with copy semantics, as the graph fixture does;
  - one in-process runner per CLI surface, with two tests per surface that go through a real process;
  - a seed cache that survives the per-file `TMPDIR`.
- **Teaching:**
  - a short project-root rule stating the may-nots and the budgets;
  - the guard's refusal and budget lines name the fix;
  - `ag-no-shit-tests` gains a cost gate.

## 5. Owners and boundaries

- runlith test infrastructure ([[7b07b2a3]]): the guard, the budgets, the system layer, the scripts and the rule.
- `db/Store.ts`: the seed cache.
- The owners of the test files each task names: they fix their own files.
- The engine sections of [[8e7c936b]] (`work`, `landing`, `merge`) stay with the architecture thread. This decision adds nothing to the engine.

## 6. Rejected alternatives

- **Running only affected tests** first. It cuts how often tests run, not how long each run takes. That is the next slice of [[f5648cf9]], after this one.
- **Deleting slow tests wholesale.** The research found no wording pins and no duplicates, so the cost is in how the tests are built, not in what they protect.
- **More workers.** The machine is shared, and at eight workers the target still needs the fixes.

## 7. Acceptance criteria

- The whole server suite, unit and integration, measured at `--parallel=6` on the least-loaded machine available, with the load average named: about 50–60 s wall, and its processor time named. If the target is not met, the close names what still stands between the suite and it.
- `bun run test:system` runs the system files, and the other layers run none of them.
- An integration file over 8 s of processor time is reported as a `budget` violation, and each such file is debt owned by a task.
- A cold and a warm seed are measured in the same run: the warm one costs tens of milliseconds, not hundreds.
- The rule stands at the project root, and the skill has its cost gate.

## 8. Claims and tasks this touches

- Claims over `db/Store.ts#seedDatabase` ([[27b8077c]]), the guard ([[d650b27c]], [[b0f2deaf]]) and the runner ([[bdeffae6]]) are revised.
- Each child task closes into the claims its change stands on.

## 9. Order of building

1. The seed cache: the largest single saving and a single change.
2. In parallel with it:
   - the system layer, the integration budget, the rule and the teaching, with the system files moved;
   - the CLI tests run in-process;
   - git batching and the worktree-finishing suite.
3. Then:
   - waits turned into events;
   - `harnessSession` isolation;
   - graph-suite sharing and slimming.
4. The whole-suite measurement, and the close.

## 10. Contract

out: internal to the test infrastructure; no product contract changes.

## 11. Stored data

out: nothing stored.

## 12. Who may do what

out: no operation or permission changes.

## 13. Long-lived things

- The seed cache outlives a run by design. It is keyed by the migration chain's hash and removed by the residue sweep's own rules. Its task decides that and says so in its claim.

## 14. Bounded resources

- The budgets of §4.
- Agents building this run at most one test command at a time, at `--parallel=2` or less, under the operator's 90 s limit.

## 15. Rollout

- Package by package. The budget first reports; files already over it are entered as debt before the budget refuses anything new.

## 16. Failures

- A seed build that fails fails the first file that needs it, naming the cause, as it does today.

## 17. Observability

- `scripts/testLayer.ts` answers the per-file processor time and the budget violations.
- The close names the before-and-after figures.

## Divergences

- **ff770b2e: the guard enforces no may-not in integration files:** [[5a517343]].
- **ff770b2e: the system layer runs at no merge yet.** Only `bun run test:system` runs it; the merge run point is an engine section of [[8e7c936b]].
- **ff770b2e: the system wall budget of 60 s** was measured over `hostBoot`, `worktreeSpawn` and `threadMove` only. The Docker suites ran skipped, because no daemon answered.
