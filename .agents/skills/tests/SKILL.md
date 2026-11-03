---
name: tests
description: Write, change, review, delete or run tests in runlith — which tests to run after a change and when a wide run (`check:change`, `test:all`) is allowed, whether a test should exist, `*.test.ts`, `*.itest.ts` and `*.e2e.ts`, fixtures and worlds under `testing/`, `@runlith/testbed`, Vitest configs, a slow, flaky, order-dependent or red test; e2e and Playwright in real engines — the Chromium, WebKit and Electron lanes, the iOS Simulator with MobileSafari, touch, fling and momentum input, component stands, headed runs and measuring programs. Carries the gate a test passes, junk shapes and how to review them, the port a test goes through, what makes a test expensive, worlds and tenants, shared-world traps under `--no-isolate`, and how a real-engine test is written, run and debugged.
---

# Tests in runlith

Tests run on a developer's own machine, beside their other work and often beside several agents in the same checkout: every test you write or run is paid by all of them. The Effect test API is in `effect4`, mounting the app's graph in `frontend`.

## Whether a test exists

A junk test is worse than none: it stays green while the product breaks, freezes a weak design and slows every refactor. Before writing, changing or keeping a test, answer:
- **contract**: which owner's public operation, and which invariant, boundary, state transition, persistence rule or failure mode;
- **consumer**: who breaks if it regresses;
- **signal**: why typecheck, lint or the owner's existing tests do not already catch it;
- **failure**: would it fail for a real product bug, not only when this patch is reverted;
- **cost**: the fewest worlds, births, processes and rows that prove it.

A weak answer means no test. Assert state, output or a typed failure through the owner's public operation (rule 4f387de2); a defect test goes through the real caller's door and fails first (rule 571311f8). The cheaper real signal where no test earns its place: typecheck and removing the impossible state for a shape change; nothing for copy, layout or prompt wording; the boundary owner's real request building for an external payload; the real parser, store or migration with representative data for persistence; for UI, only a non-trivial projection or intent forwarding.

## Kind: unit, integration or e2e

The suffix is the kind; testbed (`packages/testbed`) enforces it at the call site.
- `*.test.ts` — unit. Guards refuse a process, a disk write, a socket (loopback too) and SQLite at the test process's builtins; external network is refused there for every file. Outside the guards: what a child process does, and, under Vitest on Bun, an external dependency importing a builtin as ESM ([[37f542a9]]). Over 1 s it is slow.
- `*.itest.ts` — real git, SQLite, processes and disk; over 10 s it is slow. It has two possible subjects: an adapter's conformance on its real resource, or one end-to-end path through the real door (a defect test per rule 571311f8). An integration test does not launch a browser. A package with one runs it through `test:integration`: `testbed itest [flags]`, which discovers every `*.itest.ts` of the package, or a Vitest `integration` project. `test:all` refuses its plan while an itest stands in a package without that script.
- `*.e2e.ts` — a real engine driving a product outcome through its real door. It may use sockets, processes and disk; over 10 s is slow. `testbed e2e [files/options]` discovers only e2e files, and `test:e2e` calls it; ordinary `test`, `test:integration` and `check:change` do not select them. Screenshots are failure evidence, never assertions about copy or layout.
- `*.bench.ts` — a measuring program, not a test: it prints cost and runs by hand (`bun <file>`, a stand's bench through `testbed e2e --program`, a Vitest bench project through its own script). No test run, change check or CI gate selects it, and nothing in it asserts time.
- Native tests — `cargo test`, `swift test` — run from a package's `test:native` script and need that toolchain and platform; a package's `test` script runs only its `*.test.ts`.
- A test fails only on its own fact, never on time or machine load. testbed's one deadline is a 3-minute hang guard on every test and hook, set in every file; a slow test passes, and the run report names it `slow` with its CPU and its children's, the wall that measured CPU does not cover, its world and tenant time and its file's processes — the cue to cheapen it at its owner.
- Logic reached only through a real resource is a missing port, not an itest. It becomes a unit test through the owner's public operation over fast adapters:
  - disk: `@runlith/testbed/memory` — `Effect.provide(program, Memory.layer)`; one layer build is one volume; host permissions and watcher ordering stay itest ([[e9f3c3e0]]);
  - processes: the `@runlith/executions` contract with the host doubles in `apps/tagma/server/src/executions/testing`;
  - thread and agent logic: the memory conformance in `packages/agent/src/thread/conformance`; persistence is proven once on the real store (`native-harness/storagePort.itest.ts`);
  - git: a port in the module's own terms, never an emulation of git argv, which would be a second git. Model: `BranchRefs` (`worktrees/contract/service/refs.ts`), filled by `makeGitBranchRefs` over `@runlith/git/Git` in the product and by `memoryBranchRefs` in tests; composition fills it and the core names no adapter (rules e090f46d, 6f758080).
- SQLite stays real SQL. A test that needs SQL is an itest and opens its store on `sharedPool` or `heldPool` (`@runlith/sqlite-process/testing/pool`: in process, no child); a store opened without a pool spawns child processes. A test whose subject is a child-process property — reader-lane removal, store isolation, handover, process loss — takes `childHosting` ([[a6950a0e]]).
- Every fast adapter has one conformance suite, run on the real adapter in an itest and on the fast one in a unit file: `packages/testbed/src/conformance/fileSystem.ts` (`fileSystem.itest.ts`, `memory.test.ts`), `worktrees/testing/refContract.ts` (`refs.itest.ts`, `refs.test.ts`). Green on fast and red on real is a divergence: fix the adapter and add the case to the suite.
- Count before building a port (git-site preload, reference `measuring`); where a port turns no file into a unit test, cut births, opens and acts, merge scenarios and delete covered paths instead.

## Real-engine fixtures

The package is `packages/e2e` (`@runlith/e2e`). The native iOS lane end to end is reference `ios`; how a component stand records and judges is reference `stands`.

**Lanes.** `e2e(name, async ({ page, context, browser, lane, cdp, touch, electron, artifacts }) => …, { lanes, context, electron, headed })` from `@runlith/e2e/browser` registers `name [<lane>]` per lane; `e2e.effect` takes a scoped Effect body. Lanes are `chromium` (the default), `webkit` and `electron`; a file names every lane it proves. `ios(...)` from `@runlith/e2e/ios` registers `name [ios-<runtime>]` per runtime. `E2E_LANES` (`chromium,webkit,electron,ios`) narrows a run; the iOS lane runs when it is unset or names `ios`.
- Chromium runs the managed browser's pinned Chrome for Testing cache (`bun apps/tagma/server/scripts/fetch-browser.ts`) with the mock keychain and gives `cdp`. WebKit needs `playwright-core install webkit` and has no `cdp`. `touch` exists only in a Chromium context with `hasTouch: true`: a held finger whose `press`, `move` and `release` take CSS points and are driven through CDP touch events.
- A worker holds one engine, and taking another lane closes it: order a file's tests by lane. Each engine has its own temporary profile; each test gets a fresh context with service workers blocked.
- Electron launches per test from the `electron` options or a lazy factory of them, its executable defaulting to `E2E_ELECTRON_EXECUTABLE`, and exposes the Playwright application as `electron`. The app keeps every window hidden; a scenario that needs a visible desktop declares `headed: true`.

**Waits.** Every Playwright timeout is 0: wait on a page fact — `waitForFunction`, a locator's `waitFor`, a promise the page resolves on its own event — never a deadline or a sleep. Page code waits by frames (`requestAnimationFrame`) or on its own events. The hang guard stays the run's only deadline.

**Failures.** A page `Error` or unhandled `Error` rejection fails the test as `PageFailed`; a console error or a non-Error rejection is only diagnostic. A failed test writes its screenshot, console log and Playwright trace, and every writer registered with `onFailure` from `@runlith/e2e/artifacts`, into one directory beside the run report, named in the failure as `Artifacts: <dir>`. Write a scenario's own evidence — recordings, calibrations, the values an assertion read — as JSON into `artifacts`, so a red is judged from evidence, not by a rerun.

**Product e2e** goes through `makeE2eWorld({ models })` (server `composition/testing/e2eWorld.ts`): one world per worker serves the built app, the door runtime and real HTTP and WebSocket on one loopback origin, `served.origin`, and lends a scripted model by default. Take `served.tenant` — a fresh project with `perform(operation, input)`, `thread`, `turn` (which returns once the run settles) and `upload` — seed it through product operations, and open `${origin}/<projectName>/chat/<threadId>`. Script a reply with `models: scriptedModel(stream)`; a `Deferred` inside the stream holds the reply where the page is to be observed mid-run. A failure adds the activity record to the artifacts.

**Stands.** `stand(configFile)` from `@runlith/e2e/stand` builds a Vite stand once per run in a file-level hook and serves it on loopback; `served.url(path)` addresses it.

**Running.**
- `testbed e2e [files] [bun test flags]` runs only `*.e2e.ts`, as `testbed itest` runs only `*.itest.ts`. Without files either discovers the tracked ones of its own package: outside dot, `node_modules`, `build`, `dist`, `coverage`, `out` and `target` directories and outside nested packages, which run their own. Package `test:e2e` scripts call it; `test`, `test:integration` and `check:change` never select an e2e file. A process an e2e file leaves running fails the file.
- An e2e worker takes two machine-budget units (one on a one-unit machine), and browser files run in parallel workers. Files sharing one external resource — a visible desktop, a fixed port — run with `--parallel=1`; the Simulator is one run per machine (reference `ios`); a measuring program runs alone.
- `testbed e2e --headed` also runs `headed: true` scenarios; without it they are reported `headed, not run`. A headed run and the iOS lane are live checks: run them only where the task allows (rule c6569513). A headless `*.e2e.ts` is a test: run the ones you wrote or affected.
- `testbed e2e --program <file> [args]` runs a measuring program — a stand's bench or baseline — with one e2e worker's budget and a run root, but no test hooks and no hang guard. It opens `serveStand(config, { own })` and `session(lane, context, { own })` from `@runlith/e2e/engines` in an Effect scope, so servers and browsers close normally.

## What makes a test expensive

- **Project birth** (`stealthProject`: `git init` plus the product's `add_project`) runs git and the product: birth once per file or scenario; only a test whose subject is the birth pays it per test.
- **Product acts**: a landing (`submit_work`), a graph pool open and a birth each spawn many git processes. Count a scenario's acts and keep only those its assertions need.
- **git by path**: testbed puts the developer directory first in PATH ([[5294065f]]); a test that rebuilds PATH or calls `/usr/bin/git` by path pays the macOS xcrun shim on every git.
- **World builds**: the door world builds the full runtime and an `own` door world builds it again for one file; the graph world is cheap. Each extra worker process repays module load and every world kind it needs.
- **Cold pools and spawns**: start one Worker pool per worker for every rig (`change-record/testing/walks.ts`), never one per helper call. Each child `bun` boot and `tagma` CLI run pays a process start: call the operation in process where the CLI is not the subject.
- **Polling**: an `Effect.repeat` poll costs a round trip per step and makes process counts vary between runs; wait on a fact instead.
- **Imports**: `composition/runtime.ts` loads most of the server; a file importing the runtime for one function pays all of it.
- **Scale**: the fewest rows, files and iterations that cross the boundary under test — paging with `limit=2` over three rows, not a default page; one and two roots prove a slope.

## Writing a cheap test

- **World per worker.** Scripts run `--no-isolate`, so a world is built once per worker and shared by its files; testbed sets the worker count from its share of the machine's process budget, and a number in the command only caps it ([[f7db8209]]). `world(kind, params)` from `@runlith/testbed/worlds`, and `doorFixture(...)` without `own`, register their own build hook: call them when the file registers, so the build is the file's setup rather than its first test. `demoGraphLayer(...)`, `checkoutFixture` and a helper's `shared(kind, params)` build lazily inside the group's layer hook.
- **A shared world is never torn down.** A successfully built shared world's scope finalizers do not run; the reaper kills its held processes when the worker exits ([[82279b2b]]). Restoration or a final write that must happen goes in the test's own scope; a test whose assertion depends on the world's finalizers takes `own`.
- **World key** = the kind's tag and the canonical JSON of its params. Params are data: a function or a layer makes the world `own`. Lend `models`, `decisions`, `quotaProviders`, `vendorWire` and `exposure` through the shared door world (`doorFixture({ models })`, `makeDoorWorld({ models })`); the lend lasts the scope that asked for it. A per-file value such as a stop time is set in the file's scope: as a param it builds a second world.
- **`own: '<reason>'`** only when the test changes state the shared world cannot get back — machine settings, accounts, Tagma apps, MCP servers, commits into the global project, maintenance, `process.env` — or when the world's own lifetime is the subject (close, restart). The report lists every own world with its reason.
- **Tenants.** A graph tenant is a template copy; a runtime tenant is a real birth. A project-scoped setting goes on a fresh project instead of an own world; a user-scope change is restored exactly in the scope's finalizer; `projectLeaving(world, id)` removes the projects a test made.
- **One scenario per expensive setup**: tests sharing a world, a birth or a boot become one scenario with the same assertions.
- **Drivers.** The door world starts none unless `drivers` names them (`drivers: ['rollout-shelving']`); a defect or race test names the drivers its real caller runs with.
- **Waits end on a fact** — `Deferred`, `Queue`, a feed event, the projected row, a process exit (rule 7609a86c). Under `it.effect`, time moves only by `TestClock.adjust`.
- **Doubles answer every call** the scenario makes and finish the ones it does not care about: a double that never answers hangs the test as soon as the code around it gets faster.
- **Observe cheaply**: read a store file read-only with `bun:sqlite` rather than opening a store layer per check.
- **Build artifacts** (execution-host bundle, CLI) come from `cachedArtifact` in `packages/execution-host/src/buildArtifact.ts`, keyed by inputs across workers and runs; there is no second cache.

## Shared worlds under `--no-isolate`

A worker keeps one module registry for all its files: module-level state lives for the worker.
- State leaking between files is fixed at its owner — clear the shared double in `beforeEach`, open connections in the test's scope, unmount and clear `document.body` in `afterEach` — never by restoring isolation; an assertion over a shared module counter compares before and after, never an absolute count.
- Temp directories are made in a scope (`beforeAll`, a fixture directory), not at module top level: Bun imports the next file before the previous one leaves, so an import-time `mkdtempSync` lands in the previous file's root ([[131e63f6]]).
- A shared world's machine — its machine and user settings, provider registry, accounts, model catalogs, Tagma apps — serves every file of the worker. testbed gives each file its own HOME, XDG, TMPDIR and git config and restores `process.env` after it; it never resets a world.
- Order: files can pass in one order and fail in another, so a test file you write or change runs on three seeds (Checking a change). A red in a batch is reproduced from the worker's file sequence in the report, run with `--parallel=1 --no-isolate`, and bisected.
- `--isolate` (CI, the isolated full run) rebuilds every shared world per file: a kind builds into a fresh home and assumes no leftovers. The summary line "world built more than once in one worker" means the same key was built twice in one worker: expected under `--isolate`; under `--no-isolate` a failed build retried or a second module instance. A key that differs by accident is two keys of one kind: read the world rows' `key`.
- Unit and itest files are not mixed by hand in one worker: a unit file judges a shared world's background spawns as its own.
- Vitest runs with `isolate: false` as well. A file that stubs a global or a module — `vi.mock`, `vi.doMock`, `vi.stubGlobal`, observers, animation frames, element size prototypes — is named in its config's isolated list (`isolatedUnit` and the `unit-isolated` project in `apps/tagma/app/vitest.config.ts`); every other file cleans up what it mounts.

## Never in a test

- patch pinning: a test that fails only when this exact edit is reverted, or one written because a line or branch changed;
- absence pinning — `not.toHaveProperty`, "removed X stays absent" — unless X is a field of a real external boundary the test exercises. `expect(streamTextMock.mock.calls[0]?.[0]).not.toHaveProperty('maxOutputTokens')` after removing an unsupported option pins the patch through mocked plumbing and proves no request works: assert what the real boundary sends, or let typecheck carry it;
- mock bookkeeping: call counts, option bags, pass-through arguments;
- private helpers, and an export, wrapper, fake, injection, guard or impossible-state branch that exists only so a test can. A port in the module's terms whose product adapter composition fills is architecture, not such a seam. A test needing a huge mock graph marks a wrong boundary: give the owner a typed port. Business logic asserted through a UI path is tested at the owner hiding in that view;
- model-facing text — prompts, guidance, agent messages — and labels or copy, asserted exactly, by substring, snapshot or absence: test the runtime contract, schema, parser, tool gate or persisted shape that owns it; a data string the contract defines is a valid assertion;
- snapshot walls, and ordinary UI — layout, forms, buttons, visual state — unless that test was asked for;
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

A wide run takes every core of the machine for minutes and slows every other agent and the person's own work on it. A change to a module the server loads reaches most server tests by import, and most of them only pass through the changed code: running them proves little that the tests below do not.

- Run what your change plausibly broke, and nothing for safety's sake:
  - the test files you wrote or changed;
  - the tests beside the files you edited;
  - the tests that exercise the behaviour you changed, found by reading its callers and grepping its name in `*.test.ts` and `*.itest.ts` — not every file that imports the module.
- Run them in one command from their package: `<repo>/node_modules/.bin/testbed bun test --no-isolate ./src/a.test.ts ./src/b.itest.ts`; a Vitest package through its script with the file names. A test file you wrote or changed also passes alone on `--randomize --seed=1`, `2` and `3` (Shared worlds under `--no-isolate`).
- `bun test` does not typecheck: `bun run typecheck` in the packages you touched before claiming green.
- A green run is not repeated without a new change or a failure.
- Inside a task, no wide run unless one was asked for: no `test:all`, no `check:change`, no whole package's `test` or `test:integration`. The whole suite runs on request or in CI. When a change reaches further than you can check this way — a shared contract, a schema, a migration, testbed itself — the hand-off says so and names what was not run.
- A red in a file your change did not touch goes to its holder (Shared tree); it is not a reason for a wider run.
- A review judges tests by their source and runs none.

### Wide runs, when asked

- `bun run check:change` runs the unit and itest files whose loaded code the change reaches, reusing results by input hash. Inside a Tagma session the change is the lines this session holds uncommitted in the checkout (`read_changes`); outside one, the diff against the branch base. Name it with `--commit <ref>` for landed work, `--paths-from <file>` (one path per line) for other paths, or `--base <ref>`. `--plan` prints the selection and why each file is in it without running anything.
- A file is selected when its import closure reaches a changed path. The closure follows every runtime import, lazy `import()` included, and skips type-only imports; `import.meta.glob` expands over the tree. A non-source or unimported changed path reaches its whole package. A changed lockfile, `bunfig.toml`, `tagma.config.ts`, migration, patch or `packages/testbed` runs every file.
- A nonliteral `import()` (a computed path) selects the files reaching it until a run of that file under `check:change` has recorded what it loaded; the recording lives in the machine's cache beside the results. A site that hundreds of files reach declares what it may load from the checkout in its package's `changeCheck.loads` (`{"<file in package>": [<checkout globs>]}`, `[]` for nothing); every traced run fails a file whose load the declaration lacks. Only Bun files are traced, and only in the test process: a Vitest file, or a site reached through a `new Worker(...)` edge, stays selected on every change until its package declares the site.
- `bun run test:all` runs every workspace. It and `check:change` run each package as one runner over all its files on the machine's process budget, through one testbed scheduler: run it once; never split a selection and run its parts one after another.

### Running and reading a run

- Concurrent test commands share the machine's process budget, each through testbed; a script whose files share one external resource caps itself with `--parallel=1`. testbed sets no life on a run.
- testbed's summary gives CPU per file, the items load, world, tenant, body and guard, children by kind, worlds built and own, and the slow tests with their cost; `check:change` prints the slow tests after its results. CPU-seconds change under machine load too; compare CPU and wall at similar load. Before/after, profiles and git counts: reference `measuring`.

## Shared tree

Many agents edit one checkout at once; a broken import stops every test that loads the module.
- An export is renamed or moved together with all its importers, in one commit.
- A port lands with its composition wiring, in one commit: a service no layer provides fails every runtime world with "Service not found".
- A new workspace dependency lands with its `package.json` entry and the lockfile `bun install` writes.
- Every shared file stays importable between edits.
- A deletion lands at once, with explicit `paths` in submit_work, and `git ls-files` confirms it: under load git's fsmonitor lags and a deleted file can read as clean.
- A red caused by a peer's change in progress goes to its holder (read_changes on the path); continue with another file.
