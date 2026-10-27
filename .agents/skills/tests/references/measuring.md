# Measuring test cost

`<location>` is the skill's folder as load_skill answers it; commands run from the test file's package.

## The run report

- testbed writes one JSONL per run under `/tmp/runlith-test/reports/` (the summary prints the path; the newest 40 are kept). Rows: `file` (worker, sequence, kind, items load/world/tenant/body/guard as cpu and wall ms, children sqlite/git/other with count, cpu and unmeasured, residue), `test` (body, tenant and world per test), `world` (kind, key, built or taken, own reason, cost), `refusal` (a unit file's guarded call), `worker` (its file sequence), `run` (wall, CPU, items, children, worlds, seed).
- Outcomes: under Vitest a `test` row carries its name and outcome. Under Bun the CLI joins junit afterwards into separate `outcome` rows (file, test, name, outcome) and one `file-verdict` per file. A file passed only when its `file-verdict` is `pass`: it fails on a leftover process (`residue`) or a test count that disagrees with junit even when every body passed.
- A file's items sum to its total; a child's CPU sits inside the item it ran in and again under `children` ([[cd1e8244]]). Tenant work counts as body unless the fixture marks it with `span('tenant')` or `measure('tenant', fn)` from `@runlith/testbed/fixture`.
- File rows and the run row can disagree for resource suites (one quiet reading: 2496 s in file rows against 2184 s run CPU). Compare like with like.

## CPU, wall and load

- CPU-seconds measure consumed processor time, not a fixed amount of work: core speed, contention and memory pressure can change CPU as well as wall. Compare only adjacent alternating runs (A B A B) of the same files at similar load (`uptime`); record machine, load, worker count, seed and whether each file built or took its world. A ratio across unlike loads does not establish the price of the code; a suspected bottleneck needs a controlled comparison.
- A standalone cold run of a file that normally takes a ready world repays the world build and the module load: it is not comparable to a shared-worker baseline, and a ratio between the two proves nothing.
- The whole suite: `bun run test:all [--jobs cap] [--randomize] [--seed N] [--package path] [--script test|test:integration] [--report file] [--plan]` runs every suite through testbed and prints wall and CPU per suite and the red files. A suite that does not fit a command's life is made cheaper at the source of its cost, never split or resumed in parts (rule 5c30294c). `--jobs` caps the processes testbed would otherwise take from the budget, so two readings are compared at the same cap.
- Seeds: `--randomize` makes testbed print the seed and `--seed=N` repeats the order; for Vitest testbed turns `--randomize` into `--sequence.shuffle --sequence.seed`.

## Git per call site

`scripts/git-sites.ts` is a preload recording every git the test process spawns: argv, cwd, verb, the Effect call-site chain and the root span. Each worker writes one `git-sites.<pid>.<time>.jsonl` into the directory.

```sh
GIT_SITES_OUT=/abs/dir <repo>/node_modules/.bin/testbed bun test --preload <location>/scripts/git-sites.ts --parallel=1 ./src/x.itest.ts
bun <location>/scripts/git-sites-report.ts [--top 30] /abs/dir/git-sites.*.jsonl
```

The report counts git by file, verb and call site, git per root operation, and the same argv in the same cwd repeated inside one root. A repeat is a candidate, not proof of a redundant read: a write between the two, or a repeated write, is legitimate — read the call site before cutting it. The count barely moves with load but does with polling and watcher timing (one file: 1259, 1152 and 1138 in three runs): compare before and after by call site, not totals alone.

## CPU profile

`bun test --cpu-prof` writes no profile here. `scripts/profile.ts` profiles through `node:inspector` one worker process from its first hook to its last: under `--no-isolate` that is every file the worker ran, listed beside the profile in `<profile>.files.json`. Profile one file by passing one file; a batch's profile is attributed to files through the testbed rows, never its name.

```sh
PROF_OUT=/abs/dir <repo>/node_modules/.bin/testbed bun test --preload <location>/scripts/profile.ts --parallel=1 ./src/x.itest.ts
bun <location>/scripts/profile-report.ts /abs/dir/worker.<pid>.<time>.cpuprofile [--under packages/sqlite-process]
```

- Read self time, counted in samples. Inclusive time under a callback frame — an IPC `receive`, a socket or Worker message handler — holds every fiber the callback resumed synchronously. A door file read "71.5% on the SQLite path" when 59.2% of all samples were product code resumed inside `connection.ts receive` and the client's own cost was ~10%. `--under` prints the self share inside the matched code beside the inclusive share.
- Under Bun profiles vary between runs and the sampler takes fewer samples than asked. A profile names a lead; an A/B of the cut confirms it before anything is built on it.
- Both preloads write their artifacts through `writeDiagnostic` from `@runlith/testbed/fixture`, past the guards, so they work in a worker whose last file is a unit file; that file's own writes stay refused.

## Vitest counters

import, environment and transform are Vitest's own sums, not CPU, and under shared workers environment is counted again per file. Compare wall and test bodies; transform falls with `experimental.fsModuleCache` once its cache is warm.
