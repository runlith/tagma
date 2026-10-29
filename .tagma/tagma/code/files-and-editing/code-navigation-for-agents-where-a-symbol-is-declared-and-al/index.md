---
id: 01a1612d-2135-7f12-8deb-91b934378e8f
title: "Code navigation for agents: where a symbol is declared and all its places, with a verdict on each text occurrence"
ord: 26
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a160ac-a870-762d-bd02-51d89ad28cc8
---
## Why

Before editing, an agent finds out where a symbol is declared, who calls it, and who implements it. In Effect code, frequent method names (`decide`, `release`, `stop`, `deliver`) and service/interface calls are the norm, and here grep either drowns in same-name noise (for `decide`, 299 rows in 114 files with one call and 37 implementations) or loses calls outside the path the agent narrowed the search to.

A one-shot `code-nav` MCP server on the TypeScript 7.1 API tested the hypothesis ([[9ad28cc8]]). Established:

- **Tokens.** On the task "find calls and implementations of seven symbols" (Muse Spark 1.3 xhigh, three runs per side), the agent with navigation spent on average 0.57 M input tokens vs 4.98 M for the agent with grep (0.27 M vs 1.28 M without cache) and half the time.
- **Completeness is on par; misses differ.** Of 74 places, navigation missed 0, 3, and 3 (calls to `rowsOver` through destructuring; cheap runs believed the "0 calls" answer), grep missed 2, 1, and 2 (a call with an unexpected receiver, an implementation in a test stand). Neither had false places.
- **Edit outcomes: no effect.** No broken edit caused by a grep miss was found in 31 historical cases; a broken signature is caught by typecheck. Value lies in behaviour edits, which typecheck does not see.

What the A/B did not show: six of seven symbols came from cases where grep had erred; each was handed a ready `file:line`; sides never saw each other's tools; seven questions went as a batch to a warm server; one model. Whether the agent calls navigation itself next to grep, and whether that lowers a whole task's price, is unmeasured. So construction is opened by the gate below.

TS 7 engine cost (measured in [[01a1612e-6b66-7d24-936f-7dcdad6f3c02|the probe]]; one sample, macOS arm64, 12 cores / 32 GB; three schemes — all 92 tsconfigs, one synthetic program over 7825 files, only the real agent and server tsconfigs — all give the same):

- cold start with the first heavy question: 7–12 s; warm questions: p50 34–57 ms, p90 69–124 ms;
- after 30 s idle, TS 7 drops the link-search scratch checker, and the next question re-derives types: 5.8–10.6 s, the one after it 28–99 ms;
- after any real edit, even a test file nobody imports, the program gets a new checker, and the same question costs 5.3–6.2 s with a snapshot update of 8–18 ms;
- process memory: 1.2–2.1 GB after load and 3.2–4.5 GB after seven questions.

The checker itself is created in fractions of a millisecond; seconds go to type re-derivation and allocator work. No single-program merge removes this cost. This is the raw engine's price, not the answer to the agent: the holder must hide it.

**Operator goal.** Fast and without slowdowns: a 100–200 ms average is the guide, but 400 ms or about a second is fine when the tool is useful. Multi-second stalls, lags, and an engine eating the machine's memory and CPU are unacceptable. Seconds after edits and idle are a defect that the device below removes: the answer goes from a warm snapshot, changed files are checked against text, and a new snapshot warms in the background. Target user is a large project, runlith and larger, up to VS Code scale: on a small project grep is enough (operator decision).

## Gate

The operator decided to build without waiting for step 2; step 2 follows construction as a benefit measurement on the built navigation instead of the MVP. The rule below is recorded before runs.

1. **"Other symbol" share and "unverified" size.** A script without agents over the TS 7 engine and ripgrep: 30 random exported service members split by name frequency; a verdict on every text occurrence. Done ([[01a1612e-6b66-7d24-936f-7dcdad6f3c02|probe]], seed 20261022, scripts in its scratch): of 38 307 occurrences in TS, 318 are places of these symbols and 15 through alias; `rg -w` in the declaring package misses 138 of 333 places, 118 of them calls (at 5 of 30 members, most at `TokenStore.add` — 98 places outside `packages/llm`). With the owner origin and form rules, "unverified" is 28.7% of occurrences, of which 24.1 pp are strings and comments; without them, 6.05% of the remaining candidates. Twenty negative verdicts were read against the code — none are true places. The pass over 30 members took 74 s, of which 40 s were verdicts on candidates: at a frequent name there are thousands, and one API call per frequent-name question does not fit a 200 ms goal.
2. **Agents on edit tasks** — after construction, on the built `definition` and `uses` in native display. Tasks are the latest N merged behaviour edits of a shared service or interface member, picked by this rule before runs. Navigation is an ordinary tool next to grep, with no grep ban and no ready lines. Benefit is proven when navigation is called in at least half of the runs editing a shared member, pair-median full tokens per task pair are down by at least 25%, and review findings are no more. The run count fits that difference at a 2.7× spread within a side, and its price is named before launch. Unproven means the operator decides what happens to navigation.

## What the agent gets

Two Tagma operations, one name on every door — the native tool, `tagma op`, and MCP for other harnesses' agents:

- `definition` — where a symbol is declared, through imports and re-export;
- `uses` — every place of a symbol, each with a kind — call, implementation, value passing, type, import, alias — and the function it stands in. Optional kind filter. The MVP's four operations led to double calls: agents called both `callers` and `references` for each symbol.

**When to call.** Models habitually search with grep; the prompt names search as `glob` and `grep`, and one tool description is not enough: Sonnet called `uses` in about half the runs, Muse never called it. So navigation repeats one imperative sentence — before searching with grep for who calls a member, ask `uses Owner.member` — in three places: a prompt line at a thread born with navigation on; a switch-on notice at a thread born earlier; and once per thread after a `grep` whose pattern looks for a member call. With navigation off the sentence is in none of the three places. The `uses` and `definition` descriptions are shortened so the prompt with navigation is shorter than before overall (operator decision: the prompt does not grow for one feature).

**Input.** A path (absolute or from the checkout root), a line number, and a name. Only identifiers on the line are taken, never strings or comments; several different symbols with that name get an answer per symbol or a refusal with a list; a line shifted by another's edit resolves the symbol nearby, and failing that, in the whole file (several symbols with that name get an answer per symbol), and the answer names the taken line.

Or `Owner.member` with no line — for the frequent "who calls X.y" before any file is read. Owners with that name come from code-fact declarations and imports (memo by blob, no checker), so `Effect.fn` and `Schema.Struct` also find an owner from a library outside the repository (imports are resolved by the engine); a member is looked up on the value's type, the instance's type, and the type the owner returns — for an Effect service that is its `['Service']`, a TypeScript-adapter rule, not the core's. Several owners (in runlith `Checkout` is declared 10 times, `Session` 8) produce an answer per owner or a refusal with a `path:line` list.

**Answer.** Every text occurrence of the name in the search scope gets exactly one verdict:

- **this symbol** — a row with kind and function;
- **alias** — alias places are in the answer (defined below);
- **other symbol** — only a count of matches and distinct symbols, with no names: the agent looks for the target's places and never acts on outside names. A local variable is another symbol when its value did not come from the target (initializer, parameter, destructuring source), and an alias when it did; an object without a context type is another symbol when its form mismatches the target owner type;
- **in a string or comment** — also only a summary with a file count: a possible string key, but the engine does not check it, and there are many such occurrences (9246 of 38 307 in the gate sample);
- **outside code** — occurrences in files that are no language's code for navigation (JSON, markdown, lockfiles, and the like) — also only a summary with a file count: a frequent name has thousands of them (for `release` in runlith, 13 623 of 13 721 answer rows), and as rows they bury the true places;
- **unverified** — with a cause: no program for the file, `.svelte`, `any` type or error, unparseable file, degraded project, file changed after the snapshot, broken alias chain. Only this class is the answer's boundary, by file with a cause.

Answer rows go symbol places first, then unverified positions, then the boundary by file. With no adapter, no program, no file parsing, or no working configuration, there is one `boundary` row per file and cause with an occurrence count, no positions or text: the agent needs the path to check the file or fix coverage. Changed-after-snapshot, untyped, unclear-verdict, and cut-alias rows stay as `unverified` rows with current position and excerpt: the agent must read the concrete place. `summary.boundary` on every page counts all unverified occurrences by cause, including both row kinds. A place row carries an excerpt around the occurrence, never the whole file line; pass cost does not depend on line length.

**Alias** is import and export renaming (`import { x as y }`, `export { x as y }`) and destructuring whose property resolves into the source type's property that is the target, plus shorthand or assignment from it. An explicit type projection onto the target member (`const f: Owner['Service']['member'] = …`) is an implementation, not another symbol, even when the value did not come from the target. An alias link is directed — only the value flow from target to alias: a shared stub like `unused`, substituted into several services, never merges their methods into one symbol; unclear origin means "unverified". Depth is at most two hops; each rename is one more ripgrep pass over a new name.

An empty answer with no verdict summary is forbidden: agents read "0" as final. LSP gives no such mark ([[bded77fa]]), so classification is the core's job, not the adapter protocol's.

**Revision and own edits.** The answer names the snapshot revision and how many files the snapshot lags the worktree. In files changed after the snapshot, candidates are found in current text and receive "unverified: changed after the snapshot" with current rows; confirmed places in them move over the diff or drop to the same verdict. When the changed files include the target's declaring file or a file on its type path, a tsconfig, `package.json`, or a lockfile above a file the answer read, the answer warns in one row that verdicts in other files may be stale. This way the agent sees its just-made edit even in an old-snapshot answer.

**Pages.** A popular member has hundreds of places: `limit`, `total`, and a cursor ([[68659e3b]]). Limit and total count answer rows: one file-and-cause boundary is one row regardless of occurrence count. The summary over all verdicts plus engine state repeats on every page, even when file-boundary rows remain on later pages. The first page counts the whole answer; a cursor addresses its ready rows and revision for a bounded time rather than requiring the same engine snapshot: neighbouring edits never block finishing the answer.

## Why the core, not an outside MCP

A deferred display and a pass over current text of changed files are within an outside MCP too, so an improved MCP in the gate rule has them. Arguments for the core:

- memory and CPU budget for the whole machine, aware of its worktrees and agents, plus engine lifetime over them;
- agent writes through tools reach the engine holder before the answer instead of waiting for a watcher event;
- the shared checkout-change stream instead of a private watcher;
- the operation catalog carries `definition` and `uses` to every door, with a shared answer contract for all languages.

## Device

- **Own navigation kit.** Contract, candidate pass, classification, and answer live in a new kit, not in the [[5e1647fa|code-facts]] kit: that kit answers with synchronous facts per file over a handed tree, with memo by blob, for the commit court's deterministic judgment and a browser door ([[925a1c1c]]); navigation is asynchronous, walks the worktree, and rests on a process. The navigation kit imports code facts (Svelte scripts, declarations, and USAGE as a cheap syntactic candidate filter) and the [[90d97bc9|ripgrep]] kit — text candidates come from it, not from a private search implementation ([[51c66cb6]]).
- **Adapter contract.** The core leads candidates, summary, and answer; the adapter returns a verdict, kind, and enclosing function per position — that is the language's semantics, unknown to the core ([[6f758080]]) — plus `definition` and found aliases. A language with no adapter leaves all candidates "unverified", i.e. an honest grep.
- **TypeScript adapter.** The engine process: the TS 7 `typescript/async` client and `tsc --api` live in it, not on the server event loop — the client parses AST and holds a source cache of its own ([[7a910861]]). Whether to reach TS 7 through API, LSP, or a hybrid ([[e973b466]], [[cfb93aa0]]) is decided by measurement, including on a repository built into `.d.ts` or project references: in runlith packages export sources, and every program contains the declaration, which favours the API with no cross-project orchestration in measurement.
- **Projects.** Loading by candidates — opening projects by default for candidate files instead of all tsconfigs — helps only repositories with split projects. On runlith it gives nothing: packages export sources, nearly every app program pulls almost all code, and measuring all 92 tsconfigs, one synthetic program, and only agent + server gave the same.
- **Engine holder: a server module.** One engine per repository, shared by all agents and all its worktrees, rising on the first question. Changes come from `CheckoutWatch.follow(rootId)`, HEAD changes from `CheckoutRows.headMoved`; agent writes through tools reach the holder immediately.
- **Snapshots.** The holder serves questions from one warm snapshot and warms only the newest revision in the background, and only after a question: edits nobody asked about accumulate, and the answer names their files as changed-after-snapshot ([[61d1db53]]); the serving snapshot is replaced only by a ready new one. A warm snapshot in a quiet checkout does not go cold: the TS 7 checker idle-expiry is a question-4 edit, and until then the holder deliberately keeps the serving snapshot as is, whose TS 7 pool does not clean on idle (measured: 163 ms after 35 s idle vs 6.3 s for a cooled one). The first question with no snapshot waits for engine load — seconds once per repository: a grep-level answer instead of waiting is useless to the agent, which asked for an exact one (operator decision). A new worktree of a running engine waits only for counting its differences from the base, and while its own snapshot is not warm it receives an answer over the base snapshot with these differences as "changed after the snapshot". There is by design no "no engine" answer: the tool exists for all agents or for none (operator decision). A question waits for its engine — a free slot, a restart after a fall; a fall repeating in a row is a failure with a diagnosis, not a verdict. A post-idle question pays no multi-second cold start: the engine never stops on idle, returns collector garbage in quiet, and keeps type caches warm; an idle worktree drops its snapshot and stays connected (device measurement — [[8689cf64]]).
- **Memory.** Grows with requests, not projects: 1.2–2.1 GB after load vs 3.2–4.5 GB after seven requests. The budget counts the serving, warming, and held snapshots; the warm-up peak is the shared AST and type caches of two checkers — from the measurement's two numbers, about 5–7 GB per checkout (unmeasured). When two snapshots do not fit the budget, replace instead of overlap, and during warm-up the answer is "unverified". All engines' total memory stays within a machine budget ([[fe83acfa]]), eviction by least recent use, engine process memory cap (`GOMEMLIMIT`). The engine runs on any machine Tagma runs on: a small machine gets a smaller memory limit and slower answers, but answers.
- **Any number of worktrees, no duplicates (operator decision).** Some users keep all agents in one checkout, others make each small task its own worktree; navigation is exact in both cases, at any worktree count, lean, fast, and lag-free. One engine per folder (~4.5 GB on runlith) cannot give this: TS 7 shares no parsed files across different worktree paths ([[33a13e53]]), and the machine budget admits only a few engines. So the engine is one per repository: a worktree snapshot is a layer of its differences from the base over shared parsed files and shared programs (the API TS 7 `fileSystem` layer; cloning a snapshot of an unchanged project keeps program and checker), paths translate both ways, idle worktrees' type caches are freed first. The machine budget guards against memory overuse, not against worktree count.
- **CPU.** Engine parallelism is capped (`GOMAXPROCS` or priority): agent builds and tests run alongside. An interrupted tool call cancels its question; one long question never holds the others.
- **Engine state is in the answer boundary:** revision and lag, misconfigured projects, projects degraded by options TS 7 rejects (`moduleResolution: node`, `baseUrl`, `target: es5` give TS5108/TS5102 and drop type checking), missing `node_modules`, missing generated config (`.svelte-kit/tsconfig.json`).
- **Fall.** The old generation closes before the new one is published; questions that waited for the fallen process wait for the new generation's snapshot instead of receiving a refusal.
- **Operations.** The holder manifest declares `definition` and `uses`, their pages, and voice; the operation catalog carries them to CLI, native tool, and MCP itself.
- **Commit index is not in the first version.** A stored index plus a changed-file layer is wrong by itself: editing an exported type or config changes links in files that never changed ([[40bae4ba]], [[18b3e3f3]]). It is allowed only with dependent recompute and stale-fact hiding; the first version is a live engine.
- **Whose answer is right where.** Import resolution for the commit court stays with code facts (TS 6, its own Svelte alias rules — [[8f9cb294]]). Navigation's `definition` goes through TS 7 and may disagree with it; a disagreement is a defect in one of the two, not two opinions.
- **TS 7 version.** The package is pinned to a version, a binary for each platform ships with the Tagma build ([[520698f4]]), and a version change passes a regression set: the 74-place reference, the deferred acceptance set, and a "snapshot warm after 31 s idle" check.

## Modules and question flow

Three new modules plus composition wiring; `set_module` writes cards and links in the same work.

- **Navigation kit** (`packages/navigation`, kit). Contract: question, per-occurrence verdicts, boundary, revision, adapter-capability declaration; candidate pass through the ripgrep kit; verdict merge, "other symbol" summary, pages. Holds no processes or TypeScript; the adapter arrives through a port filled by composition ([[e090f46d]]).
- **TypeScript adapter** (`packages/navigation-ts`, kit). The engine process entry point and its protocol: inside the process — the `typescript/async` client and a child `tsc --api`; snapshots and background warm-up, verdicts with kind and function by position, `definition`, alias, degraded-project detection, the `['Service']` rule for Effect-service owners. Frames between holder and process ride the [[ffc6963b|NDJSON-RPC]] kit; matching many pending requests is the holder's job.
- **Engine holder** (a server module). Repository-engine lease for a checkout, lazy start, generation change on fall, checkout question queue with cancellation, subscription to `CheckoutWatch.follow` and `CheckoutRows.headMoved`, agent-write admission, machine budget and eviction driver, engine-state reading, the `definition` and `uses` operation manifest.

A `uses` question flows as follows:

1. The operation finds the checkout by path and takes an engine lease; with no snapshot the question waits until the engine rises and serves the first snapshot.
2. The ripgrep kit returns every occurrence of the name in the checkout; outside-code occurrences go straight to the summary, while `.svelte`, program-less files, and files changed after the snapshot immediately receive "unverified" with their cause.
3. On the serving snapshot the adapter finds the symbol at the question point, its places via the TS 7 link search, and a verdict, kind, and function for each remaining candidate. Over alias — at most two hops, each with its own ripgrep pass.
4. The kit merges verdicts, folds "other symbol" into the summary, adds revision, lag, and engine state, and cuts into pages.

**Performer checks per module** are public contracts only ([[4f387de2]]): the navigation kit — verdicts and boundary on a fake adapter; the TypeScript adapter — on a small sample repository with destructuring, import renaming, object implementations, an Effect service, a degraded tsconfig, and missing `node_modules`; the holder — lazy start, generation change, eviction, a warm snapshot after idle, and its own edit on a real engine process.

**Languages.** The first adapter covers `.ts`, `.tsx`, `.js`, `.jsx` — i.e. React too — by the operator's estimate, most of Tagma users' code (unmeasured). Svelte is low priority: Tagma itself is written in it, but most users are not. Svelte is not a neighbouring adapter but an embedding in the TypeScript adapter through the TS 7.1 content mapper ([[d97c8d39]]): TS-symbol calls from `.svelte` need a TS program. Until then, occurrences in `.svelte` are "unverified" candidates. Other languages are unpromised: their engines need toolchains Tagma does not ship, and some execute repository code (build scripts and proc-macros in rust-analyzer, Gradle); with no adapter a language gets an honest grep with a boundary.

**Operator decisions.** Build now, without waiting for gate step 2: step 1 gives the "unverified" ceiling for acceptance; the A/B on edit tasks follows construction as a benefit measurement. This spec holds only the TypeScript adapter; other-language adapters start when their time comes. Speed beats accuracy: no slow path is offered; the TypeScript 5/6 engine on JavaScript (including tsserver with `typescript-svelte-plugin`) is excluded; a small accuracy loss is acceptable when the answer names it. Svelte is low priority. No private TypeScript implementation is written: the engine is TS 7, a fork when needed.

**Switch (operator decision).** Navigation is switched on and off by a setting — for the project and for all of the operator's projects; off by default while the engine recomputes on every checkout change with no questions (live measurement on runlith: 1–3 cores and 7–8 GB constantly at 55–137 lagging files while agents write and commit). Switched-off navigation holds no engine process, and agents never see `definition`/`uses`: new threads do not receive them, working ones lose them on the next step; a call that reaches the operation anyway receives a "navigation off" refusal, not an engine.

The product version is new code; the one-shot `code-nav` package is replaced by the core and removed along with its MCP declaration.

## Open questions

1. API, LSP, or hybrid for the TypeScript adapter — on runlith and on a repository built into `.d.ts`.
2. Whether `CheckoutWatch` delivers changes over ignored paths (`node_modules`, `dist`, `.svelte-kit`) that types depend on. No: a directory fully ignored by git is never watched; its appearance arrives via rescan, and the engine learns a dependency change from the lockfile ([[6324930f]]). Open: an install that did not change the lockfile, and rebuilt `dist` and `.svelte-kit` before the next rescan, stay invisible.
3. Numbers: per-engine and per-machine memory budgets, the engine memory limit on a small machine (on one machine — no lower than 2 GiB: below that memory never shrinks while cold questions double), idle worktree lifetime before rest, parallelism cap — from measurements on several machines, not one sample.
4. The TS 7 checker idle-expiry edit: it is set inside the pool (30 s) and is not exposed through the API; the edit is a fork or a PR into TypeScript.
5. What lowers memory. How much of 3.2–4.5 GB is live type caches vs uncollected garbage removable by `GOMEMLIMIT`; whether held-snapshot type caches can be dropped without losing 200 ms; the live-engine floor on runlith is 1.2–2.1 GB right after load, and when the goal is below it, a disk index is needed — currently outside the first version.

6. A worktree whose lockfile or dependencies diverge from the base: serving it with the same engine instead of a separate one. Solved by the same engine: a layer substitutes `node_modules` top-level records diverged from the base by content, transitive versions included; a worktree with no own install answers over the base dependencies with a `dependencies` problem ([[fb0717af]]).

## Acceptance

Performer checks:

- the deferred set — random symbols, Svelte calls, test stands, destructuring, import renames: no true place lands in "other symbol"; the "unverified" share among candidates outside strings and comments is at most 6% on the gate step-1 sample;
- the 74-place reference: all found, including `rowsOver` calls through alias;
- the answer is fast in every engine state except the very first question to a checkout — warm, after 31 s idle, right after an edit, and while warming a new snapshot: the guide is 100–200 ms on average, up to a second allowed; no multi-second MVP stalls; time by state and on frequent names is measured and named; the answer names revision and lag;
- the agent's edit is visible in the next answer: candidates in the changed file follow current text, with a "changed after the snapshot" verdict;
- the first question with no snapshot waits for the engine and receives verdicts, not "unverified" candidates;
- checkout-size-runlith engine memory is markedly below the current 3.2–4.5 GB after seven questions; the figure is recorded after measurement; total engine memory stays within the machine budget; eviction fires;
- 6 simultaneously active runlith worktrees with small differences all receive exact verdicts at once, with no duplicate engines; all navigation memory is about one engine plus differences, not a multiple of the worktree count, and answer time matches a single checkout;
- a degraded project, missing `node_modules`, and a generated config are named in the boundary;
- a frequent name on runlith (`release`, `stop`, `CheckoutWatch.follow`): true places on the first page, outside-code occurrences as a count in the summary, the server counts the answer in no longer than a second, page size independent of file-line length;
- no answer ever says "no engine"; a post-idle question past the eviction term has no multi-second stall;
- switched-off navigation holds no engine process and is invisible to agents; switching on returns the tools with no server restart.

Time and memory bars are recorded after measurements.
