---
id: 01a0e7ea-163c-7b00-9d75-6d1927d2324e
title: package-boundary is replaced by the `platforms` builtin over manifest platform conditions, `modules` and per-package `direction` rules, and deleted only after they stand at gate
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
Accepted by the reach-design session on 2026-09-28, after independent reviews by Opus (claude-opus-5-5, xhigh) and Astra (gpt-6-astra, xhigh). Every blocking and should-fix finding that held against the code is folded in below.

`package-boundary` is deleted. What a package entry, an app file or a worker loads at run time, per platform, is judged by a new `@tagma/inspection` builtin, `platforms`. It reads each entry's platforms from the manifest's export conditions, through code-facts' selector, and resolves every start under the real condition set of its platform.

- Workspace relations, territories and roles belong to `modules`.
- Floors inside a package are `direction` rules.
- The Vite build guard becomes a program inspection at watch after `merge_worktree`, subject to one measured condition (4.5).
- Everything else is dropped with its reason.

The package is removed in a second landing, after the replacement rules stand at gate in the main graph. No guarantee lapses in between.

This completes the head amendment of [[be799808]] (2026-09-28). It is built by [[3e810e46]].

## 1. Observable outcome

- The gone:
  - the `@runlith/package-boundary` package;
  - every `readPackageBoundary` suite;
  - `boundary.direction.ts`;
  - `browserBuildBoundary()` in both apps' `vite.config.ts`.
- The rule `platforms` stands at gate before `submit_work` and `merge_worktree`. It refuses a landing whose change makes a start load what its platform cannot run, enter a door not declared for that platform, or load what its package refuses. Examples:
  - `node:fs` reached from `@runlith/llm/models/openai` on `browser`;
  - `zod` imported by any `@runlith/agent` production file, type-only included;
  - a Tagma app file entering a `@tagma/server` door that declares no `browser`;
- Two `direction` rules keep the floors of agent and llm.
- `modules` stands at gate with a region that includes `i18n` and `agent-zod`.
- Verdicts name the start, its platform, the refusal entry and one shortest chain.

## 2. The problem and its evidence

- The operator deleted the package (head amendment of [[be799808]]).
- Its guarantees live in 20 hand-maintained suites whose entry lists drift from the manifests ([[a1e520c6]] exists for that drift). They run only when a test file runs, carry no debt and are not judged against a change.
- `modules` judges workspace imports, roles and testing entries. It does not judge what a start transitively loads per platform, or refusals of third parties and built-ins. That check has no home.

## 3. What holds now, checked against the code

**package-boundary and its suites**
- At HEAD, package-boundary's report fields are:
  - `escaping`, `undeclared`, `unimported`;
  - `refused` (from clauses, type-only included, every file under `src`);
  - `runtimeRefused` (direct);
  - `browserNode`, `browserRefused`, `browserUndeclared`;
  - `directionViolations`.
- The browser walk continues into workspace doors that are not browser-declared, carrying the origin's refusals. It drops unresolved specifiers silently and throws on an unreadable file.
- The Vite plugin refuses, at build end, a built-in that `this.resolve` does not turn into a real file. Its limitation stands in [[45146d74]] (drifted).

**What code-facts reads**
- code-facts' `languages/js/workspace.ts` owns `conditioned` (manifest key order, nested, arrays, `default`), `exported` (the most specific pattern) and `workspaceOf` over a `Tree`.
- `resolve.ts:11` tries `x`, `.js→.ts`, `x.ts`, `x.tsx`, `x.svelte` and `x/index.ts`, in that order. Vite 8's extension order starts `.mjs .js .mts .ts`.
- `languages/js/imports.ts` records literal specifiers only. It does not record:
  - template or computed `import()`;
  - `import.meta.glob`;
  - `new URL(lit, import.meta.url)` workers;
  - the import/require form, in the `runtime` projection.
- `blobs.ts:50` answers a missing blob provisionally.
- `node/judge.ts:120,128` subtracts base-side `unjudged`.
- `node/loads.ts:49` leaves an unparsed file silently.

**Bundlers and runtimes**
- Vite 8.2.2 client conditions are `module`, `browser`, `production`, `import`/`default`, plus `svelte` from the Svelte plugin. Its server conditions are `module`, `node`, `production`, `import`/`default`, plus `svelte`. No environment reads `ssr`. Vite transforms with Oxc.
- A probe showed that Bun resolves `bun` before `node` before `import`, and ignores `browser` and `module`.
- Both apps are `adapter-static` SPAs. SvelteKit's build analysis still evaluates universal route modules (`+layout.ts`, `+page.ts`) in Node.

**Manifests and linking**
- 21 entries in `window-behavior`, `desktop-input`, `audio-capture-darwin` and `visual-identity-node` point into git-ignored `dist/`.
- Bun's isolated linker links a package's `dependencies` **and** `devDependencies`. Only `zod`, `typescript` and `@types` are hoisted to the root.

**Enforcement machinery**
- No `modules` rule is enforced in the main graph. `checks/modules.server.json` excludes the apps, `i18n` and `agent-zod`.
- `node/modules.ts:61` admits same-owner imports before the testing-role check.
- Per-ask state lives in worker memory (`inspecting.ts:27-32`). Each lane has its own worker, which stops after 60 s idle ([[dbb7d715]]).
- `INSPECTION_FAILURES` has no `ceiling` cause, and builtins run untimed ([[6b14a1ad]]).

## 4. Target model

### 4.1 Where each guarantee goes

| package-boundary guarantee | Carried by |
|---|---|
| Browser closure of browser entries (`browserEdges`) | `platforms` on `browser`, extended to `ssr`, `node` and `bun` |
| `browserNode` | `platforms`' inherent refusals: the pinned built-in list, `bun`, `bun:*` |
| `browserRefused` | `platforms` `packages[n].loads.browser` and global `refuses.browser`, **checked at the origin across every workspace door the walk passes** |
| `refused` over every file, type-only included | `platforms` `packages[n].names`: read with `every`, direct, over every production file of the package |
| `refused` of a workspace package (agent → mcp, execution-host → agent, files/git → agent, source-comments → agent, server → app/desktop/execution-host, inspection → server) | `modules` relations, enforced at gate in stage 1b before anything is deleted |
| `runtimeRefused`, agent → `@runlith/llm/profiles` | `modules`: llm's `profiles` entries become a `port` (type-only) for `@runlith/agent`. It is no longer written in `platforms`, so the edge has one declaration. |
| `browserUndeclared`, `browserConsumers` | `platforms` *enters a door not declared for the platform*, from app starts and every entry. The walk **continues** into that door, so nothing behind it goes unjudged. |
| `escaping` | `modules` territories. The region gains `i18n` and `agent-zod`. An escape to another directory of the same package is dropped: same package, same dependency law. |
| `undeclared` | `platforms` kind *undeclared*: a production file's runtime import of a workspace package missing from its manifest's `dependencies`, `peerDependencies` or `optionalDependencies`. The linker also links `devDependencies`, so it does not carry this. |
| `unimported` | dropped: manifest hygiene. Relations and refusals are the law, and a stale dependency widens neither. |
| `skip` and [[2231737b]] | dropped: starts are declared, so no directory needs excluding. |
| A declared entry that answers no file ([[a1e520c6]]) | `platforms` *unresolved*, sited at the manifest. |
| agent and llm floors, and their debt pairs ([[ef89cc03]], [[c4a60ae4]], [[3f69f7f8]]) | two `direction` rules (4.4); the pairs become per-file debt. |
| The Vite build plugin ([[45146d74]]) | program inspection (4.5). |
| mcp's SDK-border and Promise-dialect checks | not package-boundary's. They stay as mcp's own test, becoming `borders.itest.ts` because they read disk. |

The testing role is not a package-boundary report field. The same-owner gap at `node/modules.ts:61` belongs to `modules`' owner and is reported to [[3e810e46]]'s coordinator, not decided here.

### 4.2 The builtin `platforms`

**Name.** `reach` already names a rule's region and the whole-reach measurement (`Builtin.reach`, `reachOf`, `ReachAsk`, `reach.worker.ts`). `platforms` names what the builtin judges. The id is stored in rule rows, so it is chosen now.

**One declaration per fact**
- **A door's platforms: its manifest's export conditions.** These are what Vite, Bun and Node resolve. A copy in the `modules` snapshot would be a declaration no bundler reads (§6.9).
- **Roles: the `modules` snapshot.**
- **Third-party and built-in refusals: this rule's parameters.** A manifest has no field for them, and third parties are not `modules`' modules.
- **Workspace refusals: `modules` relations only.**

**Platforms and their resolution.** Resolution is the real consumer's condition set, in manifest key order. A key listed first wins over a later active one, as in Node and Vite. A `require` site swaps `import` for `require`.

| Platform | Resolves with | Admits a door that declares | Inherent refusals |
|---|---|---|---|
| `browser` | `browser svelte module import production default` (Vite client) | `browser` | pinned built-ins, `bun`, `bun:*` |
| `ssr` | `svelte module node import production default` (Vite server) | `ssr` or `node` | `bun`, `bun:*` |
| `node` | `node import default` | `node`, or no platform key | `bun`, `bun:*` |
| `bun` | `bun node import default` | `bun`, `node`, or no platform key | — |

- **A declared key is a marker.** Its value must be the file its platform's resolution selects. For example, `ssr: a` beside `node: b` is a violation, *marker not selected*, because Vite's server loads `b`.
- **The built-in list is pinned data in `platforms.ts`:** Node's `builtinModules` of the Node LTS named there, `node:`-prefixed and bare. It is never read from the running runtime, which would make verdicts vary with the runtime version and would break the browser safety of `./builtins`.
- **A browser polyfill** is admitted only through `allows.browser`, which `tightens` tracks.

**Starts**
1. Every package door on every platform it declares. A pattern door, such as `./protocol/*`, expands to the concrete subpaths in the tree and is named by them.
2. `apps[]`: every file under each `roots` directory on `browser` (for example the extension's `entrypoints/`), and the `routes/**/+{layout,page}.ts` universal modules on `ssr`.
3. Worker sites: `new URL(lit, import.meta.url)` and `?worker` / `?sharedworker` imports, as starts on their importer's platform.
4. For `names` and `loads.any`: every production file of every package on `bun`, or on `node` where the package declares only `node`. That covers workers, scripts and launch files which no export reaches.

**Reading**
- Only code-facts' `Tree`, its per-blob import sites, and `workspace.ts`. code-facts gains:
  - the import/require form on every site;
  - worker sites;
  - `import.meta.glob` with literal patterns, expanded over tree paths;
  - an explicit site for a non-literal `import()`.
- Source is read, not compiled output: Vite resolves from source with the sets above, and bundles static, dynamic, glob and worker imports. The source closure is a superset of what the bundler loads within the supported subset, and nothing outside it passes:
  - a non-literal `import()` is *unresolved*;
  - an aim that two candidates would answer (`x.js` and `x.ts`, or `x.ts` and `x/index.ts`) is *unresolved (ambiguous)*, because code-facts' and Vite's extension orders differ;
  - a reached file no adapter parses, outside `leaves`, is *unresolved*.
- `leaves` holds data suffixes: `.css`, `.json`, `.svg`, `.wasm`, `?url`, `?raw`, `?inline`. Never `?worker` or its variants.
- `apps[].internal` holds prefixes matched at a `/` boundary (`$lib`, `$app`, `$env`, `virtual:`). An import under one is a leaf, because its targets are starts themselves.
- **A door whose file is absent from the tree** is a violation, *unresolved*, except in a package named in `built`. There the door is admitted by its manifest keys and not walked. `built` is limited to the four dist packages; the package's own source files are still judged by starts 4, and `limitations` names it.

**Summaries and refusals**
- Each `(door, platform)` yields, once per ask, what its closure loads: the refused-or-not third-party specifiers, the built-ins, and the doors it enters, each with a shortest chain. This is one backward pass per package and platform, as in `loads` ([[f70c54c6]]); a cycle is one strongly connected component.
- **Origin-independent refusals** (inherent, `refuses.<platform>`, *enters a door not declared*, *unresolved*, *marker not selected*) are reported once, at the start whose own package loads the cause. A walk that continues into an undeclared door reports what lies behind it at the start that entered it.
- **Origin-dependent refusals** (`packages[n].loads.<platform>`) are checked at every start of package `n` against its transitive summary, through every door it passes. Chains concatenate. This keeps the old walk's behaviour that a browser refusal follows the origin into other packages.
- **`names` is direct and origin-local.** A `names` entry is a refused specifier in an `every`-reading import of the package's own production file, type-only included. It is not transitive: a type import of another package loads nothing, and the other package's own `names` carries its law.

**Parameters** (`platforms.ts`; stored rows decode as for every builtin):
```
{ base, allows: {browser?: string[]}, refuses: {browser?, ssr?, node?, bun?: string[]},
  packages: { [manifestName]: { names?: string[], loads?: {any?, browser?, ssr?, node?, bun?: string[]} } },
  apps: [{ at, roots: string[], ssr?: string[] /* globs */, internal: string[], files }],
  built: string[], leaves: string[], files }
```
Refusal matching is `loads`' `refusalOf`: equal, or under at a `/`.

**Verdict and fingerprints.** A violation has `file`/`line` at the offending import site (the manifest for a door that answers no file), `specifier` as written, and `chain`. `Verdict.unjudged` stays empty, because *unresolved* is fingerprinted: the base subtraction in `judge` would otherwise hide it.

| Kind | Fingerprint |
|---|---|
| refused | `<start> [<platform>] -> <refusal entry>`. The refusal entry is the list item that matched, not the specifier, so `fs` → `node:fs` or a subpath change keeps the debt ([[fe7326e0]]). |
| enters a door not declared | `<start> [<platform>] -> <door> (no <platform>)` |
| marker not selected | `<door> [<platform>] marker` |
| unresolved | `<start> [<platform>] -> unresolved <specifier> @ <file>` |
| undeclared | `<file> -> <package> (undeclared)` |
| names | `<file> -> <refusal entry> (names)` |

- `<start>` is `<package><door>` for a door start. It is the file for app, worker and file starts.
- `follows` is `() => true`, and `relocated` rewrites file tokens. A move keeps a door start's fingerprint. A fingerprint that names a moved file is followed by lineage and is not stable.
- N doors sharing one internal cause make N entries only for origin-dependent refusals.

**`tightens(prior, next)`** holds when all of these hold:
- `base` is equal;
- `refuses`, every `packages[n].names` and every `packages[n].loads` list is kept by `refusesAtLeast` (`loads.ts:77`);
- `allows` is not widened;
- `built` and `leaves` are not widened;
- every `apps` item of `prior` is kept, with `roots`, `ssr` and `internal` not narrowed or widened respectively, and its `files` under `filesTighten`;
- the global `files` is under `filesTighten`.

A looser inspection is recorded through `enforce_rule` as the `inspection` loosening, in the open. `absorb` is the separate act of adopting new debt.

**Stage-1 divergence accepted by the operator.** `apps[].generated?: string[]` names app-relative globs for outputs produced during an app build but absent from the committed tree. An undeclared missing `$lib/*` target remains unresolved. Widening `generated` is an inspection loosening. Acceptance 6 reports generated outputs separately from tracked source files; server-side coverage follows the execution criterion below.

**Stage-1 AC6 correction, refined by the operator after the build comparison.** Vite's SSR build compiles route modules even when both adapter-static apps' root `+layout.ts` declares literal `ssr = false`; compilation is not execution. AC6 compares what executes on the server, not every file Vite compiled. `hooks.server.*`, `+server.*`, `+page.server.*` and `+layout.server.*` are unconditional SSR starts. Universal `+page`/`+layout` modules and their imports are SSR starts only where the route's effective `ssr` option is not literal `false`, taking the route and its layout chain into account; a computed option counts as enabled, and prerendering with SSR enabled remains enabled. File-backed `$lib` and configured `kit.alias` entries resolve and are followed on every platform; only virtual and explicitly generated modules remain leaves. A warm run reuses per-file facts across platforms.

**Change mode and cost (rule [[2393aff1]])**
- **Facts are content-addressed.** A file's import sites are keyed by `(blob id, adapter, language version)` in a store owned by `enforcement`, on disk, shared by all three lanes' workers, and bounded by size with least-recent eviction. They are written only for blobs actually read, so a provisional empty read never enters the store.
- **Per-start results** are memoized as `(start, platform, params digest) → (dependency set, summary, violations)`. The dependency set is:
  - every path reached;
  - every candidate path probed by each resolution, both present and absent;
  - every manifest read;
  - the root manifest.

  A memo is valid for a tree exactly when each dependency path has the same blob id (or the same absence) in that tree. Checking that costs lookups in the listed tree, not reads.
- **An ask**:
  1. lists both trees;
  2. enumerates starts, including any added file that is a start;
  3. reuses every valid memo;
  4. re-walks only the invalid ones, reading only blobs the fact store lacks.

  Consumers of a changed manifest, an added file that shadows a resolution, or a newly matching pattern door are caught, because the change touches their dependency set.
- **Memo writes** are buffered by the caller and committed only when `settled` ends with no missing blob.
- **Interfaces.** `Implementation.read` gains an optional `memo` handle, and `Reading` is unchanged. `lists`/`selects`/`relevant` are as for `modules`.
- **Envelope.** It starts at `{files: 10_000, mib: 80}` over **both** sides, counting only blobs read, and is re-derived from the committed `bench:platforms`:
  - cold;
  - warm one-file change;
  - manifest change;
  - all scaled to the lowest class.

  Past it, the ask answers "not judged: subject too large".
- **Timing.** §3.12's per-ask deadline and cause `ceiling` are not built ([[6b14a1ad]]). `platforms` does not assume them: until the ask deadline lands with its own task, the envelope is the only bound, as for every builtin now.
- **Builtin fields.** `describe` summarizes with counts (for example "14 packages' refusals, 3 apps"), because the rule's line rides every thread. `reach` is `global`, `languages` is `['js']`, `unit` is `start`, and `limitations` names the build guard's residue and `built`.

### 4.3 Enforcement and rollout — two stages

**Stage 1 (this worktree's merge):**
- `platforms` with its benchmark and the code-facts additions;
- the platform keys of 4.6;
- `checks/platforms.json`, `checks/direction.agent.json` and `checks/direction.llm.json`, with debt files;
- package-boundary and every suite **kept and passing**.

The builder shows parity by running `run.ts --at <candidate commit> --base <merge-base> --debt …`, never `--worktree`, so a peer's unlanded lines never make it pass.

**Stage 1b (main graph, after the server runs the merge):**
- `enforce_rule` for `platforms` (a `#rule` at the project root) at gate before `submit_work` and `merge_worktree`;
- `enforce_rule` for the two `direction` rules (under the agent and llm modules);
- `enforce_rule` for `modules`, if it does not already stand, with its region extended to `i18n` and `agent-zod`.

Parameters come from the `checks/` files.

First-run debt is owned by the wave task implementing [[e4a0488f]] for each package, as in `checks/modules.server.debt.json`. A package without one (`i18n`, `agent-zod`, `visual-identity-node`) gets a task opened under this decision.

**Stage 2 (a landing judged by those gates):** delete the package and the rest (section 9).

Throughout, the old suites and the new rules overlap, so the one window without either is closed.

### 4.4 Floors inside a package

Two `direction` rules, one per package:
- `base` is `packages/agent/src` or `packages/llm/src`;
- `floors` are copied from each `boundary.direction.ts`, minus the member `thread/index.ts`, which names no file;
- `siblings` is `cross`, `reads` is `every`, and `files` excludes tests.

agent's three pairs (`thread/→thread/run/`, `thread/→protocol/`, `thread/run/→protocol/`) become per-file debt owned by agent's wave task. That is how [[ef89cc03]]'s law is carried. The builtin also judges a package importing itself by name ([[27eba453]]), so any pair beyond the three is shown in acceptance 7 and decided there.

### 4.5 The Vite build guard

- `platforms` carries every part of the guard over our own code, per change.
- **The residue** is a third party's own files reaching a built-in under the browser conditions. It needs `node_modules`, which is outside the tree.
- It becomes a **program inspection**, `checks/browserBuild.ts` (command contract 1, `format: tagma`, like `checks/testLayer.ts`). It runs each app's `vite build` with the guard's resolve hook and reports each built-in by the chain back to the page. It runs as a rule at **watch**, triggered **after `merge_worktree`**. It is the rule machinery's own, with debt and findings, and not a plugin mounted in the apps.
- **Condition.** Program inspections are bounded by command rules, and the project's are 1–2 min. The builder measures both apps' builds.
  - If both fit, the rule stands.
  - If not, the residue is dropped, with the limitation written as `platforms`' claim, and the builder reports the measured times to the operator.

### 4.6 Initial parameters and platform keys

**`refuses.browser`:**
- `@effect/platform-bun`, `@effect/platform-node`, `effect/unstable/process`;
- `drizzle-orm`, `@effect/sql-sqlite-bun`, `pg`;
- `sharp`, `aws4fetch`, `@smithy`;
- `oxc-parser`, `typescript`;
- `@modelcontextprotocol/sdk`, `ai`, `@ai-sdk`.

**`packages[n].names`** is each suite's old third-party `refuses`, including `effect` for `layer`, `primitives`, `query`, `seam`, `i18n` and `source-comments`, and `express`/`hono` for mcp.

**`packages[n].loads.any`** carries the vendor-SDK and driver bans transitively:
- for `agent`, `llm`, `executions`, `execution-host`, `agent-tools` and `agent-sources`: `ai`, `@ai-sdk`, `zod`, `bun:sqlite`, `pg`;
- agent also: `fs`, `node:fs`, `child_process`, `node:child_process`, `@modelcontextprotocol/sdk`.

That transitive strength is new, and its first-run debt shows where it does not yet hold.

**`packages[n].loads.browser`:**

| Package | Refused on browser |
|---|---|
| `llm` | `effect/unstable/http` |
| `mcp` | `@modelcontextprotocol/sdk` |
| `executions` | `@effect/platform-bun`, `drizzle-orm` |

The rest of the old browser lists are in `refuses.browser`.

**`apps`:**
- `apps/tagma/app` (`roots: ['src']`);

Each has `ssr` globs over its `src/routes`.

**`built`:** `window-behavior`, `desktop-input`, `audio-capture-darwin`, `visual-identity-node`.

**Platform keys are computed, not hand-listed.** The builder's first stage-1 run lists every *enters a door not declared* violation. Each door is either:
- given its platform key, naming the same file as its `default`, placed after `types` (no runtime changes, as measured); or
- left as debt with its reason.

The known set comes from the suites and the review measurements:
- the suite-listed browser entries of agent, llm, executions, `@tagma/server`, `@tagma/inspection`, files, git, mcp, source-comments, i18n (including its `protocol` patterns);
- `@runlith/code-facts/languages`;
- `@runlith/performance/{protocol,CpuProfile}`;
- `@runlith/agent/{permissions,permissions/threadSubject,thread/composition/parts}`;
- `@runlith/agent-zod`;
- `@runlith/testing/overrides`;
- the testing entries of layer, query and primitives, since every suite-listed testing entry is treated alike;

## 5. Owners and boundaries

- **`@tagma/inspection`:**
  - `platforms.ts` (browser-safe vocabulary under `./builtins`, with the pinned built-in list);
  - `node/platforms.ts`;
  - `bench:platforms`.
- **code-facts:** the selector, the reading, the site form, worker and glob sites, and the ambiguity answer.
- **`enforcement`:** the content-addressed fact and memo store, the `memo` handle, and the settled-only commit.
- **Each package:** its platform keys.
- **`modules`:** relations, territories, doors and roles.
- **`direction` rules:** floors.
- **`checks/browserBuild.ts`:** the build residue.
- No suite and no app plugin.

## 6. Rejected alternatives

- **Platforms in the `modules` snapshot:** a declaration no bundler reads.
- **Resolving `ssr` with an `ssr` condition:** no Vite environment activates it. It is a marker checked against the real resolution instead.
- **Extending `loads`:** per-door, per-platform starts and admission would put two builtins behind one id, and change its stored rows' meaning.
- **Stopping the walk at an undeclared door:** debt would then hide everything behind it.
- **Unresolved as `Unjudged`:** hidden by the base subtraction in `judge`.
- **Judging compiled output:** it needs a build per ask.
- **Reading built-ins from the runtime:** verdicts would move with the runtime version.
- **An index keyed by tree:** it misses after any HEAD move or idle worker, so most asks walk cold. Content-addressed facts and memos survive both.
- **A plugin in the apps:** a tool beside the machinery.
- **The name `reach`:** collides with the enforcement meaning of "reach".
- **One-stage deletion:** it leaves a window between merge and enforcement.

## 7. Acceptance criteria

1. After stage 2, `rg package-boundary` outside `.tagma` and `archive/` finds nothing, and both apps build.
2. On the candidate commit, with debt, `platforms` is clean. Each of the following, added alone, is refused, naming the start, the platform and a chain:
   - `import 'node:fs'` in `packages/llm/src/models/openai.ts`;
   - `import type { z } from 'zod'` in any agent file;
   - `effect/unstable/http` reached from an llm browser door through another package;
   - a Tagma app file importing a `@tagma/server` door with no `browser`;
   - an llm door's `browser` key removed (refused at the unchanged app importer);
   - `x.ts` added beside an imported `x/index.ts` (*ambiguous*);
   - a new file matched by `executions`' `./protocol/*` loading `bun:sqlite`;
   - `sharp` imported by a browser worker;
   - a door value renamed to a missing file.
3. Moving an internal file of a package keeps every door-start fingerprint, and file-start fingerprints are followed by lineage.
4. A one-file edit re-walks only starts whose dependency set holds it. `bench:platforms` reports starts re-walked and blobs read for:
   - a cold ask;
   - a warm one-file ask;
   - a manifest ask;
   - a cold-worker ask with a warm fact store.
5. The envelope is derived from that benchmark over both sides.
6. Once each, for the Tagma app, the set of workspace files `vite build` loaded is a subset of `platforms`' closure of that app's starts, as the union across the doors entered. The difference is reported.
7. The `direction` checks run clean against debt. agent's debt is exactly the three old pairs' files, or each extra one is listed and decided.
8. After stage 1b, `read_inspections` shows `platforms`, both `direction` rules and `modules` at gate, with debt owned by standing tasks. Stage 2 lands through those gates.
9. `checks/browserBuild.ts`' measured build times are reported, and its rule stands at watch or its drop is recorded (4.5).

## 8. Claims, cards and tasks this changes

**By fate:**
- **Retired with the package:** the [[0a611460]] zone, including [[a1e520c6]], [[3f69f7f8]], [[c4a60ae4]], [[2231737b]] and [[ef89cc03]]. [[45146d74]] is retired too, and rewritten as `checks/browserBuild.ts`' claim or `platforms`' limitation.
- **Claims sourced on a deleted suite or `boundary.direction.ts`:**
  - re-sourced to the manifest and the rule where the statement still holds under `platforms`, `modules` or `direction`;
  - rewritten where the statement names the suite;
  - retired where it describes package-boundary itself.

  The builder applies these three fates per claim, in stage 2:
  - agent: 37554ef0 a2a985c5 3a6f30fc 72838d25 545e5f71 6f5ac22c e0d348ec;
  - server: 3982a839 848131e4 8011d6b2 de83161e 65dcd963 b2d1fb42 f0c9d545;
  - llm: 2e23378a aa94b9c1 2062b6ac daa1c4da 0ae02efb 4a05766a;
  - executions: c8688bc5 1417007c 4b18bde4 982c079f 85a7c642;
  - mcp: d52cde58 f9020856 7c077bf7 edfd66b9 00f4c792;
  - layer: aca0e876 67671242 116dc838;
  - primitives: a5518586 d3295609 6e157a05;
  - inspection: 2309efa1 [[3315b329]] [[6c3e3c67]];
  - agent-tools: 15be2ad2 24581305;
  - single claims: 607abd5a ab9d5d2d 498c5cd3 a1a16b10 14c44ef0 8dcb5e1e;
  - `boundary.direction.ts`: 3d7b5f1f 808916e7 d15936b7.

  §6.11's rewrites of 37554ef0, 8dcb5e1e and aca0e876 are done in that same pass.

**Spec sections:**
- **[[be799808]]:**
  - §6.7 points here.
  - §6.10 AC5: "`platforms` judges every door on every declared platform, every app, route and worker start; unresolved is a violation".
  - §6.12's P0 resolver becomes "code-facts' selector read by `platforms`".
  - §6.13 12, 14 and 17 name `platforms`.
  - §6.13 16 names `checks/browserBuild.ts` at watch.
  - §6.5.2 and the order line drop package-boundary.
  - §6.9's "Browser safety declared in suites" stays.
- **[[f658e190]] §1.7:** "`platforms` for browser safety and SDK bans; `direction` rules for packages' own floors".
- **[[e4a0488f]]:**
  - The package-boundary card is replaced by "deleted, see this decision". The `@tagma/inspection` card gains `platforms`, and the code-facts card gains the site additions.
  - Every "P0 (conditional) resolver" or "package-boundary walks/resolves/refuses" in the utils, files, code-facts, llm, agent-tools, window-behavior, UI-kit, layer, testing, markdown, markdown-editor, seam, floating-frame, scroll-follow, chat-ui, app and execution-host cards reads `platforms`. The testing production-import refusal reads `modules`.
  - The llm card gains the `profiles` type-only port.
- **[[1deb33b8]]:** the package-boundary rows are void.

**Tasks:**
- **[[3e810e46]]** is retitled "package-boundary's checks become the `platforms` builtin, `modules` and `direction` rules; the package is deleted after they stand". It relates to this decision.

## 9. Order of building

**Stage 1, in this worktree:**
1. code-facts:
   - site form;
   - worker and glob sites;
   - non-literal and ambiguous answers.
2. `platforms` and its benchmark, the fact and memo store and the `memo` handle in `enforcement`, and `checks/browserBuild.ts`.
3. `checks/platforms.json` first run, and platform keys per 4.6, one commit per package.
4. The debt files and the `direction` checks, acceptance 2–7 shown with `--at`, and the debt tasks opened.
5. The `modules` snapshot: the llm `profiles` port and the `i18n`/`agent-zod` region.
6. Suites and plugins still run.

**Stage 1b, after the merge and the server's restart:** `enforce_rule` for `platforms`, both `direction` rules, `modules` and the build-guard rule.

**Stage 2, one landing through those gates:**
- Delete:
  - every suite call of package-boundary (mcp's own checks become `borders.itest.ts`);
  - both `boundary.direction.ts` files;
  - both `browserBuildBoundary()` mounts;
  - every devDependency on it;
  - the package;
  - its `modules` module, region entry and relation;
  - its `bun.lock` rows;
  - `checks/platforms.*` and `checks/direction.*`.
- Then the graph changes of section 8.

## Questions of rule 8dab19b6

1–9: sections 1–9.

10. **Contract.** `{builtin: 'platforms', params}` is new. `Implementation.read` gains an optional `memo`. `Verdict` and `Reading` are unchanged. Later parameter changes keep decoding today's shape.
11. **Stored data.**
    - New rule rows (`platforms`, two `direction`, `modules` if new, the program rule) and the content-addressed store. Nothing existing is migrated.
    - The store is derived: deleting it costs a cold ask, nothing more.
    - Rollback is `enforce_rule` withdrawal, plus a revert of stage 2.
12. **Who may do what.**
    - The operator decides enforcement, through `enforce_rule`.
    - The gates judge at `submit_work` and `merge_worktree`.
    - A wrong verdict is fixed in the builtin.
    - A loosening and an `absorb` are each recorded in the open.
13. **Long-lived things.**
    - The fact store and memos are content-addressed, immutable per key, bounded by size with least-recent eviction, and shared by lanes.
    - A memo is written only after a settled pass.
    - A worker restart loses nothing but warmth.
14. **Bounded resources.**
    - The envelope is derived from `bench:platforms` over both sides.
    - The store's size bound is derived from free disk, per rule [[fe83acfa]].
    - The ask deadline is §3.12's, when built.
    - Past the envelope, the ask answers "not judged: subject too large".
15. **Rollout.**
    - Stage 1 keeps the old suites.
    - Stage 1b enforces before anything is deleted.
    - Running threads see the new gate lines at their next instruction refresh.
16. **Failures.**
    - A dropped or crashed ask is `inspection-failed`: a refusal at gate, unjudged at watch, never debt.
    - Concurrent landings are judged against their own base, and `applyEnforcement` refuses when HEAD moved what was read.
    - A torn store write is discarded by its key check.
17. **Observability.**
    - `check_rules` and gate refusals show verdicts per start and platform, with the chain.
    - The benchmark reports re-walk counts and blob reads.
    - Acceptance 6's comparison and 9's build times go into the task report.
