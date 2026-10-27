---
name: tests
description: Write, change, review, delete or measure tests in runlith — whether a test should exist, `*.test.ts` vs `*.itest.ts`, fixtures and worlds under `testing/`, `@runlith/testbed`, Vitest configs, a slow, flaky, order-dependent or red test, the suite's cost. Carries the gate a test passes, junk shapes and how to review them, the port a test goes through, where test CPU goes with measured prices, worlds and tenants, shared-world traps under `--no-isolate`, and how to measure.
---

# Tests in runlith

Every agent pays every test on every check, on one shared machine. The target is the whole suite in 30–60 s wall; testbed prints each run's CPU per file against 40–80 ms. The Effect test API is in `effect4`, mounting the app's graph in `frontend`.

## Whether a test exists

A junk test is worse than none: it stays green while the product breaks, freezes a weak design and slows every refactor. Before writing, changing or keeping a test, answer:
- **contract**: which owner's public operation, and which invariant, boundary, state transition, persistence rule or failure mode;
- **consumer**: who breaks if it regresses;
- **signal**: why typecheck, lint or the owner's existing tests do not already catch it;
- **failure**: would it fail for a real product bug, not only when this patch is reverted;
- **cost**: the fewest worlds, births, processes and rows that prove it.

A weak answer means no test. Assert state, output or a typed failure through the owner's public operation (rule 4f387de2); a defect test goes through the real caller's door and fails first (rule 571311f8). The cheaper real signal where no test earns its place: typecheck and removing the impossible state for a shape change; nothing for copy, layout or prompt wording; the boundary owner's real request building for an external payload; the real parser, store or migration with representative data for persistence; for UI, only a non-trivial projection or intent forwarding.

## Kind: unit or itest

The suffix is the kind; testbed (`packages/testbed`) enforces it at the call site.
- `*.test.ts` — unit. Guards refuse a process, a disk write, a socket (loopback too) and SQLite at the test process's builtins; external network is refused there for every file. Outside the guards: what a child process does, and, under Vitest on Bun, an external dependency importing a builtin as ESM ([[37f542a9]]). Over 1 s it is slow.
- `*.itest.ts` — real git, SQLite, processes and disk; over 10 s it is slow. It has two possible subjects: an adapter's conformance on its real resource, or one end-to-end path through the real door (a defect test per rule 571311f8). Every test file is one of the two, and both run on every check.
- A test fails only on its own fact, never on time or machine load. testbed's one deadline is a 3-minute hang guard on every test and hook, set in every file; a slow test passes, and the run report names it `slow` with its CPU and its children's, the wall that measured CPU does not cover, its world and tenant time and its file's processes — the cue to cheapen it at its owner.
- Logic reached only through a real resource is a missing port, not an itest. It becomes a unit test through the owner's public operation over fast adapters:
  - disk: `@runlith/testbed/memory` — `Effect.provide(program, Memory.layer)`; one layer build is one volume; host permissions and watcher ordering stay itest ([[e9f3c3e0]]);
  - processes: the `@runlith/executions` contract with the host doubles in `apps/tagma/server/src/executions/testing`;
  - thread and agent logic: the memory conformance in `packages/agent/src/thread/conformance`; persistence is proven once on the real store (`native-harness/storagePort.itest.ts`);
  - git: a port in the module's own terms, never an emulation of git argv, which would be a second git. Model: `BranchRefs` (`worktrees/contract/service/refs.ts`), filled by `makeGitBranchRefs` over `@runlith/git/Git` in the product and by `memoryBranchRefs` in tests; composition fills it and the core names no adapter (rules e090f46d, 6f758080).
- SQLite stays real SQL. A test that needs SQL is an itest and opens its store on `sharedPool` or `heldPool` (`@runlith/sqlite-process/testing/pool`: in process, no child); a store opened without a pool spawns child processes. A test whose subject is a child-process property — reader-lane removal, store isolation, handover, process loss — takes `childHosting` ([[a6950a0e]]).
- Every fast adapter has one conformance suite, run on the real adapter in an itest and on the fast one in a unit file: `packages/testbed/src/conformance/fileSystem.ts` (`fileSystem.itest.ts`, `memory.test.ts`), `worktrees/testing/refContract.ts` (`refs.itest.ts`, `refs.test.ts`). Green on fast and red on real is a divergence: fix the adapter and add the case to the suite.
- Count before building a port (git-site preload, reference `measuring`). The graph's logic files spent git only on fixture setup, and enforcement's inspection workers run their own git in Worker threads: a port there would turn no file into a unit test. Where a port gains nothing, cut births, opens and acts, merge scenarios and delete covered paths.

## Where the CPU goes

Apple M2 Max, one sample each; "loaded" means other agents' tests ran beside it. 2026-10-24 baseline: 5220 s CPU over 2177 files — test bodies 60%, world builds 27%, module load 8%; git children 18% (70 953 processes), SQLite children 9%. 2026-10-27, loaded (load 5–26), every suite through `test:all`: 676 s wall, 2591 s CPU — unit 320 s, integration 2271 s, of it server integration 2057 s (754 files). Server integration by item: bodies 72%, worlds 18%, load 6%, tenant 4%; git 50 884 processes, 501 s; landing and enforcement files carry a third of its CPU and git. App unit costs 87 ms CPU per test, server unit ~10 ms.
- **Project birth** (`stealthProject`: `git init` plus the product's `add_project`): ~1 s CPU of the test process and ~29 git, loaded; 143 calls in 109 files. Birth once per file or scenario; only a test whose subject is the birth pays it per test.
- **Product git per act**: a native `submit_work` spawns ~80 git (Holdings judges 24, prepared build 11, commit steps and trees 13, landing 10, graph freshness 10, retirement 6); a graph pool open ~13. Count a scenario's acts: each landing, open and birth costs tens of processes.
- **One git process**: 22.5 ms CPU through the macOS `/usr/bin/git` xcrun shim, 10 ms direct. testbed puts the developer directory first in PATH ([[5294065f]]); a test that rebuilds PATH or calls `/usr/bin/git` by path pays the shim again.
- **World builds**: the door world (full runtime) 3.4–4.9 s CPU, an `own` door world 6–13 s each; the graph world ~1 s, its tenant ~0.1 s and no git. Each extra worker process repays module load (~0.5 s on its first file) and every world kind it needs.
- **Cold pools and spawns**: a Worker pool started per helper call pays its cold start on every call — one pool per worker serves every rig (`change-record/testing/walks.ts`); a child `bun` boot 0.18 s, 0.40 s with a cold transpiler cache; one `tagma` CLI run 0.35–0.45 s, its floor bun plus effect — 40 CLI calls in a file cost ~15 s.
- **Polling**: a stop ladder polling every 5 ms made ~400 holder round trips per stop, 35% of `ExecutionRuntime.itest.ts` (it backs off to 50 ms now). A test's `Effect.repeat` poll costs the same way and makes process counts vary between runs.
- **Imports**: `composition/runtime.ts` loads ~2000 modules (17.9 MB, 11 MB of it effect) and its build ~1270 more; a file importing the runtime for one function pays all of it. The app's Vitest with per-file isolation: 215 s wall, Vitest's counters import 216 s, environment 129 s, transform 127 s around 52 s of test bodies. Shared workers (`isolate: false`) and a warm `experimental.fsModuleCache` ended at 36 s; only the cache's own step was measured as an adjacent pair, 48 → 36 s.
- **Scale**: the fewest rows, files and iterations that cross the boundary under test — paging with `limit=2` over three rows, not a default page; 201 files still cross a digest batch where 1000 were used; one and two roots prove the slope that 20 and 200 did.

## Writing a cheap test

- **World per worker.** Scripts run `--no-isolate`, so a world is built once per worker and shared by its files; testbed sets the worker count from its share of the machine's process budget, and a number in the command only caps it ([[f7db8209]]). `world(kind, params)` from `@runlith/testbed/worlds`, and `doorFixture(...)` without `own`, register their own build hook: call them when the file registers, so the build is the file's setup rather than its first test. `demoGraphLayer(...)`, `checkoutFixture` and a helper's `shared(kind, params)` build lazily inside the group's layer hook.
- **A shared world is never torn down.** A successfully built shared world's scope finalizers do not run; the reaper kills its held processes when the worker exits ([[82279b2b]]). Restoration or a final write that must happen goes in the test's own scope; a test whose assertion depends on the world's finalizers takes `own`.
- **World key** = the kind's tag and the canonical JSON of its params. Params are data: a function or a layer makes the world `own`. Lend `models`, `decisions`, `quotaProviders`, `vendorWire` and `exposure` through the shared door world (`doorFixture({ models })`, `makeDoorWorld({ models })`); the lend lasts the scope that asked for it. A per-file value such as a stop time is set in the file's scope: as a param it builds a second world.
- **`own: '<reason>'`** only when the test changes state the shared world cannot get back — machine settings, accounts, plugins, MCP servers, commits into the global project, maintenance, `process.env` — or when the world's own lifetime is the subject (close, restart). The report lists every own world with its reason.
- **Tenants.** A graph tenant is a template copy; a runtime tenant is a real birth. A project-scoped setting goes on a fresh project instead of an own world; a user-scope change is restored exactly in the scope's finalizer; `projectLeaving(world, id)` removes the projects a test made.
- **One scenario per expensive setup**: tests sharing a world, a birth or a boot become one scenario with the same assertions (`collaborationDoor`: 16 tests → 1 scenario with 3 births; `idleCopies`: 3 runtime boots → 2).
- **Drivers.** The door world starts none unless `drivers` names them (`drivers: ['rollout-shelving']`); a defect or race test names the drivers its real caller runs with.
- **Waits end on a fact** — `Deferred`, `Queue`, a feed event, the projected row, a process exit (rule 7609a86c). Under `it.effect`, time moves only by `TestClock.adjust`.
- **Doubles answer every call** the scenario makes and finish the ones it does not care about: a model double returning `Stream.never` passed while SQL was slow and hung once SQL got faster.
- **Observe cheaply**: read a store file read-only with `bun:sqlite` rather than opening a store layer per check.
- **Build artifacts** (execution-host bundle, CLI) come from `cachedArtifact` in `packages/execution-host/src/buildArtifact.ts`, keyed by inputs across workers and runs; there is no second cache.

## Shared worlds under `--no-isolate`

A worker keeps one module registry for all its files: module-level state lives for the worker.
- State leaking between files is fixed at its owner — clear the shared double in `beforeEach`, open connections in the test's scope, unmount and clear `document.body` in `afterEach` — never by restoring isolation. Leaks found: a status double's health carried over, a live connection outliving its test, DOM left mounted, an absolute count over a shared module counter.
- Temp directories are made in a scope (`beforeAll`, a fixture directory), not at module top level: Bun imports the next file before the previous one leaves, so an import-time `mkdtempSync` lands in the previous file's root ([[131e63f6]]).
- A shared world's machine — its machine and user settings, provider registry, accounts, model catalogs, plugins — serves every file of the worker. testbed gives each file its own HOME, XDG, TMPDIR and git config and restores `process.env` after it; it never resets a world.
- Order: the baseline had 21 server itest files red only when shuffled. Every file a change touches passes alone on `--randomize --seed=1`, `2` and `3`. A red in a batch is reproduced from the worker's file sequence in the report, run with `--parallel=1 --no-isolate`, and bisected.
- `--isolate` (CI, the isolated full run) rebuilds every shared world per file: a kind builds into a fresh home and assumes no leftovers. The summary line "world built more than once in one worker" means the same key was built twice in one worker: expected under `--isolate`; under `--no-isolate` a failed build retried or a second module instance. A key that differs by accident is two keys of one kind: read the world rows' `key`.
- Unit and itest files are not mixed by hand in one worker: a unit file judges a shared world's background spawns as its own (task af42588f).
- Vitest runs with `isolate: false` as well. A file that stubs a global or a module — `vi.mock`, `vi.doMock`, `vi.stubGlobal`, observers, animation frames, element size prototypes — is named in its config's isolated list (`isolatedUnit` and the `unit-isolated` project in `apps/tagma/app/vitest.config.ts`); every other file cleans up what it mounts.

## Never in a test

- patch pinning: a test that fails only when this exact edit is reverted, or one written because a line or branch changed;
- absence pinning — `not.toHaveProperty`, "removed X stays absent" — unless X is a field of a real external boundary the test exercises. `expect(streamTextMock.mock.calls[0]?.[0]).not.toHaveProperty('maxOutputTokens')` after removing an unsupported option pins the patch through mocked plumbing and proves no request works: assert what the real boundary sends, or let typecheck carry it;
- mock bookkeeping: call counts, option bags, pass-through arguments;
- private helpers, and an export, wrapper, fake, injection, guard or impossible-state branch that exists only so a test can. A port in the module's terms whose product adapter composition fills is architecture, not such a seam. A test needing a huge mock graph marks a wrong boundary: give the owner a typed port. Business logic asserted through a UI path is tested at the owner hiding in that view;
- model-facing text — prompts, guidance, agent messages — and labels or copy, asserted exactly, by substring, snapshot or absence: test the runtime contract, schema, parser, tool gate or persisted shape that owns it; a data string the contract defines is a valid assertion;
- snapshot walls, and ordinary UI — layout, forms, buttons, visual state — unless the operator asked for that test;
- a typecheck duplicate: a field, a union branch or a signature existing;
- "does not throw" or "it starts" with no state asserted, assembled smoke, a fixture's self-test, an outcome that depends on a live model's obedience (script the agent);
- a skip, `todo`, `.only` or list of known reds: a red test is fixed or deleted in the change that found it (rule 93739392);
- a deadline of its own — a test's third argument, a hook's, `layer(l, { timeout })` or `Effect.timeout` around a wait: it turns load into a red. A wait ends on a fact, a hang is the guard's, slowness is cut at its owner. A deadline stays only where the product's own timeout is the subject;
- a sleep or a deadline poll;
- a weakened assertion: an assertion over incidental shared state is replaced by the contract's, not loosened;
- a matrix repeating one scenario across transports or doors: one conformance per transport (native `packages/agent/src/thread/conformance/transportConformance.test.ts`, ACP `protocolRoad.itest.ts`, Claude `claudeConformance.itest.ts`, terminal `terminalConformance.itest.ts`); an HTTP replay of logic its owner tests is deleted;
- a load or scale sweep, a pin of which modules a file imports;
- moving or splitting a file to escape its cost.

## Reviewing, deleting and moving out

- A review finding on a test leads with why it is junk: the missing owner or invariant, the incidental detail it pins, the cheaper real signal, and deletion where it gives false safety. A junk assertion is deleted or replaced by the owner's contract, never made cleverer.
- A deletion names its cover as `file › test name`, read, not guessed; the owner's unit suites (`packages/agent`, the module's `*.test.ts`) often prove the logic already. A variant without an equal cover is named as dropped, never claimed covered.
- Logic leaving an itest goes to the owner's unit suite through its public operation; the itest keeps only what the real resource adds.
- `RUNLITH_TEST_LAYERS=report` records a unit file's refusals as report rows instead of failing them: it shows what a file moving to unit still touches.

## Checking a change

- `bun run check:change` checks the change: the unit and itest files whose loaded code it reaches, results reused by input hash. Inside a Tagma session the change is the lines this session holds uncommitted in the checkout (`read_changes`); outside one, the diff against the branch base. Name it yourself with `--commit <ref>` for landed work, `--paths-from <file>` (one path per line) for other paths, or `--base <ref>`. `--plan` prints the selection and why each file is in it without running anything.
- A file is selected when its import closure reaches a changed path. The closure follows every runtime import, lazy `import()` included, and skips type-only imports; `import.meta.glob` expands over the tree. A non-source or unimported changed path reaches its whole package. A changed lockfile, `bunfig.toml`, `tagma.config.ts`, migration, patch or `packages/testbed` runs every file.
- A nonliteral `import()` (a computed path) selects the files reaching it until a run of that file under `check:change` has recorded what it loaded; the recording lives in the machine's cache beside the results. A site that hundreds of files reach declares what it may load from the checkout in its package's `changeCheck.loads` (`{"<file in package>": [<checkout globs>]}`, `[]` for nothing); every traced run fails a file whose load the declaration lacks. Only Bun files are traced, and only in the test process: a Vitest file, or a site reached through a `new Worker(...)` edge, stays selected on every change until its package declares the site.
- A coverage map narrows that selection for Bun files: `bun run check:map` (same scope flags; no named change maps every file in scope) runs each file without a current map alone under `--coverage` and keeps, from a passing run whose sources did not move, the lines it executed, its import closure and the entries of its child `bun` processes. A mapped candidate drops out, named in `--plan` under `dropped`, unless the test itself changed, a changed path is not JS/TS, lies outside its import closure, or runs in its Worker or child process, an edit since the map run touches a line it executed (an edit inside a function counts when the function ran; a top-level statement that acts at load, or an edit inside a top-level declaration, counts for every loader; a test file in the closure counts whole), or its closure gained or lost a module that acts at load. An edit of types, comments or formatting only selects nothing. A map whose executed code changed since its run is stale: the file stays selected by imports until `check:map` maps it again.
- It and `test:all` run each package as one runner over all its files on the machine's process budget, through one testbed scheduler: run it once; never split a selection and run its parts one after another. A review judges tests by their source and runs none.
- A file you touched passes alone, from its package: `<repo>/node_modules/.bin/testbed bun test --no-isolate --randomize --seed=1 ./src/x.itest.ts`, then seeds 2 and 3; a Vitest package through its script. Concurrent test commands share the machine's process budget, each through testbed; a script whose files share one external resource caps itself with `--parallel=1`. testbed sets no life on a run: a command lives as long as the operator's command rules allow.
- testbed's summary gives CPU per file against 40–80 ms, the items load, world, tenant, body and guard, children by kind, worlds built and own, and the slow tests with their cost; `check:change` prints the slow tests after its results. CPU-seconds change under machine load too; compare CPU and wall at similar load. Before/after, profiles and git counts: reference `measuring`.
- `bun test` does not typecheck: `bun run typecheck` before claiming green.

## Shared tree

Many agents edit one checkout at once; a broken import stops every test that loads the module.
- An export is renamed or moved together with all its importers, in one commit.
- A port lands with its composition wiring, in one commit: a service no layer provides fails every runtime world with "Service not found".
- A new workspace dependency lands with its `package.json` entry and the lockfile `bun install` writes.
- Every shared file stays importable between edits.
- A deletion lands at once, with explicit `paths` in submit_work, and `git ls-files` confirms it: under load git's fsmonitor lags by tens of seconds and a deleted file can read as clean.
- A red caused by a peer's change in progress goes to its holder (read_changes on the path); continue with another file.
