---
id: 01a0e3c5-a2fc-71ee-aa52-fd31be799808
title: Every package Tagma is built from is a module owned by meaning — entries by role and platform, ports its product fills, stored forms versioned by their owner — in one acyclic order below the server modules and the app
ord: 57
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Amended by the coordinator during the restructure, 2026-09-28:** the relation `projects → @runlith/git` (runtime entries; projects identifies a project by its repository key) the registry missed. **`package-boundary` is deleted (operator's decision):** its import and layer checks are `modules` (roles, nested territories, testing entries), its conditional resolver is `code-facts`', and its one check `modules` lacks — what a `browser`/`ssr` entry transitively loads, and the runtime refusals — becomes the builtin `platforms` in `@tagma/inspection` ([[27d2324e]]); the Vite build plugin and the per-package `boundary.test.ts` suites go with it. §6.7's "`package-boundary` stays" and the rejected alternative "one `modules` rule replacing `package-boundary`" no longer hold. Package roles are declared once, in the `modules` snapshot's entries.

**Amended by the agent-kernel architecture ([[44f7f1c3]]):** A2/A5–A8 establish product-owned evidence participants, keyed transitions with delta apply primitives, explicit catalog/runtime and model lifetimes, browser-only permission/display vocabulary, mandatory worlds and supplied budgets, nested receipt codecs and owned post-commit recovery. This amended decision governs wherever earlier wording differs; the existing one-client-per-process rule stands until scoped disposal is built.

**Amended by section 7 part 2 ([[e4a0488f]]):** the 19 corrections of [[6e8793a1]] apply — among them caller-supplied product identity in `llm`, service+type `agent-sources → agent`, `agent-tools/workspace` types split from its runtime, MCP pools scoped per project, the app's reading and settings/merge answers owned by the server. They govern where this text differs.

**Amended by §3.13 ([[9c085c6c]], its §3.13.15):** `packages/agent`'s `ThreadStorePort` replaces `updateAtomically`, `updateWithLifecycleLock` and `…InTransaction` with keyed `transition`, `control`, `prepareBirth`, `birth`, `prepare` and `transitionIn`; every kernel consumer (Tagma, workflow members) changes with it in one source change; the conformance suites and both adapters gain its replay cases; persisted forms change only with a version and decoder or migrations in both chains.

v2.1: `spec-review-06v2-arch-astra.md` — an entry's role and its restrictions now take precedence over every general grant: `testing` is a role no production code imports; `world/machine` is `executions`' alone; the app's filters admit no testing entry. No architectural change.

v2: answers `spec-review-06-arch-opus.md` (I1, I2 and the three minor points) and `spec-review-06-arch-astra.md` (P6-1 to P6-6). Every point holds against the code at `98d8d3a216` and is taken; nothing is rejected. What changed is §6.14. Names follow section 5 ([[243fd181]]): `landing` for the former `delivery`, environment backends, `machineWorld`, `CaptureRig`, `Actor.session`.

# Tagma architecture spec · Section 6. Packages Tagma uses — draft v2

Section 1 ([[f658e190]]) draws the server's 27 modules. This section draws the rest of what Tagma is built from:
- the workspace packages the server, the app, the desktop shell and the execution host import;
- `@tagma/inspection`;
- the app (`apps/tagma/app`) and the desktop shell (`apps/tagma/desktop`).

The method is section 1's. First, what each package owns by meaning. Then how it relates to the server modules and to other packages, with the pattern that relation's nature calls for. Only then are files mapped and today's imports measured, as the control.

**Builds on:**
- section 1 [[f658e190]], including its §1.13 note to this section;
- section 2 [[70083b67]]: the kernel's delta verbs, the rollout version and the host wire;
- section 3 [[511b13e3]]: `packages/held`;
- section 4 [[d925fa0c]]: browser safety, the generated client and versioning;
- section 8 [[e04cfdcb]];
- section 9 [[6bf40362]]: `core/boundary`;
- the section 5 draft (`spec-05-names.md`), whose naming rules bind packages too.

**Measured.** At `98d8d3a216`, from a snapshot of that commit's `packages/` and `apps/`, over production sources only: tests, benches, `*.d.ts` and symlinked trees are excluded. Section 1 v10's file map assigns server files.

**Beside this file:**
- `spec-06-packages.mjs` holds the package registry, the entry roles, the grants and the combined order checker. It exits non-zero on a cycle, a relation against the order or a problem. It also runs the control and writes `spec-06-packages.json`.
- `spec-06-owners.json` is section 1 v10's server file → module map, which the control reads.

Nothing in the repository or the graph was changed, and no test or typecheck ran.

## 6.1 Outcome, problem, and what holds now

### Outcome
- **Each of the 38 packages Tagma is built from is a module** with:
  - a one-sentence ownership;
  - a kind: kit, substrate, surface or tooling;
  - entries: its `exports`, each with a role (vocabulary, port, runtime or testing) and, independently, the platforms it runs on (browser, SSR, Node/Bun), declared by export conditions;
  - specifiers it must never import.

  The 37 are 35 that exist and two new ones: `paging` and `held`.
- **Where a package and a server module meet, one owner is named by meaning** (§6.2.3). The kernel owns the mechanism a thread runs on. `threads` and `native-harness` own what Tagma fills it with.
- **The combined order** — 38 packages, the 27 server modules, the app and the desktop shell — **is acyclic.** The script checks it over 41 package relations, section 1's 152 relations and the grants, 682 edges in all.
- **A server module reaches a package through its entry roles and grants** (§6.3.2):
  - any module may import a vocabulary entry, and the types of a port;
  - only a port's named fillers import its values;
  - only the modules granted a runtime entry import it — a whole package or one named entry.
- **Package contracts are versioned by where they cross** (§6.4):
  - one commit for compile-time contracts;
  - a format version and past-version decoders for what persists or crosses a process — the kernel's stored forms in both products' stores included.
- **The app imports only `contract/wire`, through the generated client, and packages' browser-platform vocabulary and UI runtime entries.** It owns screen state and drafts, never a domain decision (§6.5).

### Problem, with evidence
- **The kernel ships Tagma's product vocabulary and generic kits nobody can find elsewhere** (F044, F061):
  - `packages/agent` declares 155 export entries;
  - `CollaborationVoice.ts:306` names Tagma's tools;
  - `agent/paging` is the row-page mechanism for graph, executions, enforcement, worktrees, workspace, platform and landing (21 imports), and `agent-tools` repeats its ceiling arithmetic in `pageFamilies.ts` (F060).
- **The server reaches kernel runtime from modules that must not run threads.** Outside `threads`, `native-harness` and `composition`, 36 production imports reach kernel entries that are neither vocabulary, nor a port's type, nor a port the importing module fills:
  - `external-harnesses` 17, `sandbox` 8, `thread-record` 4, `http` 3;
  - `change-record`, `landing`, `platform` and `socket` one each;
  - two more sit in fixtures.

  Section 1 v10 cuts most of them. This section names the class every entry belongs to, so the cut is checkable.
- **The model-wire kit carries a recording rig tied to the product** (F062):
  - `packages/llm/src/capture` drives real vendor CLIs through the execution host;
  - all 28 of `llm`'s imports of `@runlith/executions` and `@runlith/ndjson-rpc` sit there (claim [[aa94b9c1]]);
  - its corpus is about 299 MB of the repository;
  - it runs Tagma by path: `capture/clients/tagma.ts:38` computes `apps/tagma/server/src/harness/captureDriver.ts` and launches it;
  - the server reads the corpus by path in turn (`harness/capturedHooks.ts:5`), and imports rig runtime from `harness/captureDriver.ts:31-38`, a file of `native-harness`' territory;
  - `capture/main.ts:40-45` writes five `*.generated.ts` files into `llm`, which `llm`'s profiles import.
- **A package's browser safety lives in a test suite, not in its contract, and role is conflated with platform.**
  - `agent` and `llm` list browser entrypoints in `src/boundary.test.ts`: 31 and 24 of them. The app also imports `@runlith/agent/permissions`, which neither list declares (2 imports).
  - The resolver `package-boundary` walks with picks `default ?? svelte ?? types` (`imports.ts:222-225`) and never a `browser` condition.
  - A browser entry is not always vocabulary: the UI kits' entries run behaviour.
  - A neutral word is not always marked browser-safe: `files`' three entries, `git/vocabulary` and `code-facts/languages` are schemas and tables.
  - Some packages mix platforms by entry: `layer/sveltekit/server` loads `node:async_hooks` for SSR; `agent-tools/world` holds the `World` type beside `hostWorld` with Bun layers and `node:os` (`World.ts:2-14,43-77`).
  - A suite measures only when somebody runs it (F046, F077).
- **The app imports the server's `protocol/*` directly.** That is 287 imports from 62 specifiers of `@tagma/server` (283 in production files, 4 in build and testing files), including `harness/protocol`; section 4 replaces them with the generated client over `contract/wire`.

### What holds now, checked against the code
- **No workspace package imports `@tagma/*`.** Package → server edges: 0. Packages are below every server module today.
- **The package graph alone is acyclic.** 38 package → package edges carry 724 imports (Tarjan, no strongly connected component). Every edge except `llm`'s capture imports is one the registry of §6.3.1 names.
- **Package boundaries already have a measurement kit** (`packages/package-boundary`, module [[0a611460]]). It reads shipped imports, walks browser reach behind declared doors over what survives compilation, and refuses specifiers. A package's own floors are measured by its `boundary.direction.ts`.
- **The kernel refuses vendor SDKs, `zod`, filesystem, database drivers and `@runlith/mcp`, and cannot load provider presentation** (`packages/agent/src/boundary.test.ts`; claims [[e0d348ec]], [[a2a985c5]]).
- **`executions` declares no root export.** Its `./protocol` doors alone must be browser-safe, and it imports no workspace package (claims [[8c95d109]], [[982c079f]], [[4b18bde4]]).
- **The graph already holds a `#module` per package** under their own directories: [[d1caad35]] agent, [[249ce587]] llm, [[6c81c6f3]] executions (the execution host's claims included), [[13756ad0]] mcp, [[2a74de70]] performance, [[5565be05]] agent-tools, [[382fa6aa]] utils, [[0a611460]] package-boundary, [[cc59eadf]] the app, and 24 more. Their `depends-on` edges follow today's imports.
- **Server → package imports: 1,293.** The biggest reaches are:
  - `agent`: 502 over 20 modules, 358 of them from `threads` and `native-harness`;
  - `executions`: 309, 232 of them from the `executions` module;
  - `llm`: 150, 72 from `providers`;
  - `git`: 138 over 15 modules.

## 6.2 Target model

### 6.2.1 A package is a module
A package is a `#module` (section 8 §8.4). Its territory is its directory, and its form follows section 1 §1.7 with the package's own spelling:
- **Entries are its `exports`.** A subpath the manifest does not export is private. No root barrel; rule [[8183e6ef]] applies unchanged.
- **Kind** is one of:
  - **kit** — imported by other code;
  - **substrate** — a process or host facility the rest runs on;
  - **surface** — what a person reaches Tagma through;
  - **tooling** — build, measurement and dev-time code that ships in no product process.

  Tooling is a kit whose consumers are suites, builds and scripts; the section 8 vocabulary records it as `kit` with `tooling` in its body.
- **Each entry has a role and, independently, its platforms.** The two are separate axes: a browser entry may run behaviour (every UI kit's), and a server-only port may be a type a browser never needs.
  - **Roles:**
    - **vocabulary**: the words a package lends — schemas, ids, row and record shapes, status tables, pure folds. Any consumer may import them.
    - **port**: an interface the package declares for a product to fill (§6.3.3). Its types are vocabulary to anyone; importing its values is for its named fillers.
    - **runtime**: behaviour. Only granted consumers import it (§6.3.2).
    - **testing**: doubles, test rigs and conformance suites for consumers' tests — any entry under `testing`, `test-utils` or `conformance` or a `*/test.svelte` component. Production code never imports one, whatever grant it holds, and a testing entry proves nothing about browser safety.
  - **Precedence.** A role and an entry's own restriction are decided before any general grant. A module granted a whole package (`'*'`) or all its vocabulary still cannot import one of its testing entries, or an entry restricted to named consumers.
  - **Platforms**, as export conditions on the entry:
    - `browser`: safe in a page;
    - `ssr`: runs in a server-rendering process, as `layer/sveltekit/server` does with `node:async_hooks`;
    - `node`/`bun`: server or host processes only.

    An entry without a `browser` condition is not browser-safe. The resolver of §6.7 reads these conditions.
- **An entry that mixes a port and its implementation is split.** `agent-tools/world` becomes the `World` port and a runtime `world/machine` holding `machineWorld` (section 5: today's `hostWorld`). `WorkspaceChanges` keeps its port type apart from its Bun hashing.
- **What it must never import** is declared per package and kept by `package-boundary` (§6.7): vendor SDKs where the package owns the wire itself, filesystem and database drivers in a kit that is handed its storage, and Node built-ins behind a browser entry.
- **Floors inside a package** stay the package's own `direction` measurement.

### 6.2.2 The packages Tagma is built from

| Package | Kind | Owns | Browser entries | Must never import |
|---|---|---|---|---|
| `tsconfig` | tooling | The TypeScript baseline every workspace extends and the typecheck command. | — | — |
| `utils` | kit | Primitives no product should spell twice: values read from outside, patches, partial JSON, work in flight and its ending, failures as text. | every entry | any workspace package; anything with an effect at import |
| `paging` **(new)** | kit | The mechanism of a read that answers rows: page, cursor and question identity, cursor encoding and the `cursor-stale` check, envelope arithmetic, and the family constructor. The families — rows, samples, row weight, default — stay with the owner of each answer (rule [[68659e3b]]). | every entry | any workspace package but `utils` |
| `held` **(new, section 3)** | kit | Held resources, flights, passes and the capacity ledger: the mechanisms a declared resource order is built from. | — | any workspace package but `utils` |
| `trace` | kit | The vocabulary a run's record is written in. | every entry | any workspace package |
| `ndjson-rpc` | kit | Newline-delimited JSON-RPC over a byte stream. | — | any workspace package |
| `files` | kit | Filesystem identity by witness, not by spelling. | every entry (vocabulary: `namespace`, `resource`, `witness` schemas, [[8dcb5e1e]]) | any workspace package; Node built-ins |
| `git` | kit | Invoking git and reading its answers: porcelain, history, status, worktrees, merge. | `vocabulary` (status and operation tables) | any workspace package |
| `sqlite-process` | substrate | SQLite in a process beside its caller: connections, the reader pool, the channel. | — | any workspace package |
| `code-facts` | kit | What source code says — imports, trees, floors — read from whatever tree holds it, one adapter per language. | `languages` | any workspace package ([[561d8ebe]]) |
| `source-comments` | kit | Finding and classifying comments in a source file, per language. | `languages` | any workspace package |
| `ripgrep` | kit | Where a search finds its ripgrep binary. | — | any workspace package |
| `executions` | kit | The contract between a product and the process host: the execution vocabulary, the execution port, the client for one host's socket, record readers and the spawner. | `protocol/*` | any workspace package ([[4b18bde4]]); a root export |
| `performance` | kit | Measuring a process: tracer, CPU profiles, loop stalls, memory captures, metric snapshots, their store and reports. | `protocol`, `unit` | any workspace package but `executions` (vocabulary) and `utils` |
| `trace-bundle` | kit | A run's record on disk, and its replay. | — | any workspace package but `trace` |
| `llm` | kit | The wire to every model: the language of a call, vendor protocols, routes, deployment profiles, the model catalog, sign-in, and neutral media preparation (`models/normalizeModelImage`). | `models/*` tables, `schema/*` (today's 24) | vendor AI SDKs, `zod`, database drivers; `executions` and `ndjson-rpc` |
| `agent` | kit | The agent kernel: the loop, the tool contract and its door, permissions, the thread and its run machine, the transcript model and its folds, workflows, resources, and the collaboration kit — with the ports a product fills. | pure browser vocabulary/folds, `permissions` from its new vocabulary-only definition, and dedicated `tool/display`; never the permission evaluator or mixed tool runtime | vendor AI SDKs, `zod`, `fs`, `child_process`, database drivers, `@runlith/mcp`; `@runlith/llm/profiles` at runtime; any Tagma term in shipped text (F061) |
| `mcp` | kit | MCP servers as agent tools: declarations, sessions and pools owned by the product's declaration/secret scope, tool naming, and serving over stdio. | `declaration`, `identity` | the MCP SDK outside its two borders ([[edfd66b9]]) |
| `agent-sources` | kit | The context files, skill directories and workflow directories an agent reads from a workspace. | — | any workspace package but `agent` (skill/workflow vocabulary and its owning workflow parser) |
| `agent-tools` | kit | The kernel's built-in workspace tools — files, shell, search, web — the `World` port they act through, and the machine world. | `workspace` | a product's store or server; Node and Bun behind the `World` port's types |
| `execution-host` | substrate | The execution host process: it admits, runs, holds and records executions behind the executions contract. | — | `agent`, `llm`, any product |
| `package-boundary` | tooling | Measuring what a package reaches: shipped imports, browser reach behind declared doors, refused specifiers, floors inside. | — | any workspace package but `code-facts` |
| `@tagma/inspection` | kit | The builtin inspections `enforcement` runs — modules, direction, re-exports and the rest — and their verdict shape. | `builtins` (schemas, `describe`, `tightens`, languages: what decodes and shows an enforcement document, [[3315b329]]), `verdict` | any workspace package but `code-facts`; its judges (`node/*`) run only in `enforcement` |
| `layer` | kit | The service graph a client application is declared in. | every entry but `sveltekit/server`, which is `ssr` ([[aca0e876]]) | Node built-ins outside `sveltekit/server` |
| `error-boundary`, `primitives`, `query`, `markdown`, `markdown-editor`, `seam`, `floating-frame`, `scroll-follow` | kit | The app's UI kits: failure containment, overlays, queries over the application graph, streamed markdown, the markdown editor, pane seams, floating panels, tail-following feeds. | every entry | Node built-ins; any server package |
| `chat-ui` | kit | The chat: a transcript on screen and its composer. | every entry | any `agent` entry that is not vocabulary |
| `testing` | tooling | jsdom gaps, settling and doubles the Svelte suites share. | every entry | — |
| `dev-runner` | tooling | Running a product's dev stack. | — | — |
| `desktop-host` | substrate | Desktop host mechanisms: external links, the quick-hide shortcut, window placement. | — | any server package |
| `window-behavior` | kit | A desktop window above other apps that takes no focus. | `contract/*` | any server package |
| `apps/tagma/app` | surface | The one screen a person works Tagma in (§6.5). | all of it | anything but server `contract/wire` and package browser entries |
| `apps/tagma/desktop` | surface | The desktop shell that installs, starts and shows Tagma. | `bridge` (a type the app reads) | server internals; only `installation`'s `contract/wire` |

The Tagma server itself is `apps/tagma/server` with its 27 modules (section 1).

### 6.2.3 Owners where a package and a server module meet

- **The kernel and the thread modules.**
  - `agent` owns the mechanism every agent of the monorepo runs on: the aggregate, the run machine, the transcript's model and folds, the collaboration kit's semantics, and the ports behind each.
  - `threads` fills the ports that are about a thread whatever runs it: the thread catalog and the runtime (section 1 §1.2), the inbox, directory and resources, and the event journal (section 1 v10: the journal is `threads`').
  - `native-harness` composes the loop and run machine and fills the run and fold stores.
  - `providers` fills the Effect-native model-call contract through the shared explicit `agent/model/llm` runtime adapter. The loop imports only its port and neutral vocabulary; the product owns account, credential, egress, budget and billing policy. Text, object, stream and compaction share owned cancellation, per-attempt receipts and one retry allowance. Clients are shared in their declared lifecycle scope and closed after borrowers finish; no client is opened per call.
  - The kernel carries no Tagma policy (F044, F061). A product's words — collaboration voice, tool names — reach it as an argument.
- **`executions` the package, `executions` the module, and `execution-host`.** (Environment backends: `workspace` declares `EnvironmentBackend`; `executions` implements the host backend and `sandbox` the guest backend, section 5.)
  - The package owns the concept's wire: what an execution is, the port every verb goes through, and the client for one host's socket.
  - `execution-host` owns the process on the other side of that wire.
  - The server module owns Tagma's policy over it: admission, custody, command rules, worlds, reconciliation.
  - Only the server module, `installation` (the host bundle) and `composition` import the client. Every other module and the app import `protocol/*` only.
  - The shared name is one concept seen from its three owners. Section 5 keeps both spellings; the module is the only server code that speaks to a host.
- **`performance` package and module.** The package is the measuring kit; the host and the server both measure with it. The module is the server's record of its own running (section 1). Reports read over HTTP go through the module's operations, not through the door importing the kit.
- **`mcp` package and module.** The package is the client kit and the adaptation of MCP tools into kernel tools. The module owns which servers a project declares and connects them (section 1).
- **`git` and platform's git kit.** `@runlith/git` invokes git and reads answers. Platform's git kit (section 1) builds the hook, commit and index lanes on it. `graph`'s shadow and `executions`' admitted git use the same package.
- **`llm` and `providers`.** `llm` owns every byte a vendor receives. `providers` owns whose account signs the call, credentials, quotas and the default-account map, and fills `llm`'s credential source and HTTP client.
- **`agent-tools`' World and the server.**
  - `agent-tools` declares the `World` port a tool acts through, and `WorkspaceChanges`, the port a tool reports its writes to.
  - `machineWorld` is a runtime entry of its own, granted to `executions` alone.
  - Worlds are `executions`' by section 5: it fills the machine and managed worlds; `workspace` passes the acquired environment's world through its environment backends; `sandbox` fills the guest world and imports; `change-record` fills the changes port.
  - A module that only names a world type imports the port's types.
- **`code-facts`, `@tagma/inspection` and `enforcement`.** `code-facts` reads code. `@tagma/inspection` holds the builtin judges over those readings. `enforcement` owns the rules, judgements and debt that use them (section 1). The inspection package is `enforcement`'s alone.
- **`paging` and the page families.**
  - `paging` owns the mechanism: page and cursor identity, question identity for `cursor-stale`, cursor encoding, and the envelope arithmetic that turns an explicit carrier envelope and a family's row weight into a ceiling.
  - Every family stays with the owner of its answer, with its rows, samples, row weight and default: `agent-tools`' GLOB, GREP and LISTING (`pageFamilies.ts:13-22`), the kernel's collaboration pages, and each server owner's family through platform's constructor.
  - The default is the family's, not a fixed `PAGE_ROWS = 100` (`agent/paging.ts:36`). The carrier envelope — today taken from `agent/ToolOutputSpool` — is passed in, so `paging` imports nothing of `agent`.
  - What dissolves is only repeated ceiling/limit arithmetic in `agent-tools` (F060). Its `pageFamilies.ts:cursorField` stays as an operation-specific accessor with its owning families. Cursors keep their operation, order and selection, and another question still refuses `cursor-stale`.
- **`files` and `workspace`.** `files` owns witness identity. `workspace` owns roots and their proofs over it.

## 6.3 Relations

### 6.3.1 Package → package
The registry in `spec-06-packages.mjs` holds each relation with its pattern, and this table is its reading. Patterns are section 1 §1.4.1's:
- **service**: a kit used;
- **type**: a vocabulary entry;
- **port**: an interface the target declares and the source fills or consumes;
- **argument**: data handed at build.

A package that is used everywhere (`utils`) is listed only where it is imported today.

| From | To | Pattern | What crosses | Why |
|---|---|---|---|---|
| `@runlith/agent` | `@runlith/utils` | service | values, failures, concurrency | Generic mechanics. |
| `@runlith/agent` | `@runlith/paging` | service+type | pages of tool answers | A collaboration tool answering rows pages them like every read. |
| `@runlith/agent` | `@runlith/trace` | type | trace events | A run is recorded in the trace vocabulary. |
| `@runlith/agent` | `@runlith/llm` | type+service | stable call vocabulary and catalog; llm runtime only through the explicit model adapter | The loop consumes its Effect-native model port; the adapter supplies wire conversion without importing deployment policy into the loop. |
| `@runlith/agent` | `@runlith/executions` | type | `protocol/call`, `protocol/execution`: call cancellation, execution refs | A tool call may run as a managed execution; its cancellation and progress are named in the execution vocabulary. |
| `@runlith/agent` | `@runlith/performance` | type | `unit` spans | Kernel spans are measured in the performance vocabulary. |
| `@runlith/performance` | `@runlith/executions` | type | `protocol/*`: command and execution refs in reports | A report names the executions it measured. |
| `@runlith/performance` | `@runlith/utils` | service | values | Generic mechanics. |
| `@runlith/trace-bundle` | `@runlith/trace` | type | trace events | A bundle stores trace events. |
| `@runlith/llm` | `@runlith/utils` | service | values, partial JSON | Generic mechanics. |
| `@runlith/llm` | `@runlith/trace` | type | route and profile tracing | A call's route is traced. |
| `@runlith/mcp` | `@runlith/agent` | port+type | the tool contract, the permission vocabulary, the tool output spool | MCP tools become tools of the kernel's own contract. |
| `@runlith/agent-sources` | `@runlith/agent` | service+type | skill/workflow shapes and the workflow parser | Source discovery uses the kernel owner's actual parser; it never substitutes a local JSON cast. |
| `@runlith/agent-tools` | `@runlith/agent` | port+type | the tool contract; World and WorkspaceChanges ports it declares for products to fill | Built-in tools are kernel tools acting through a World the product supplies. |
| `@runlith/agent-tools` | `@runlith/paging` | service | pages of read, glob, grep, ls | A tool answering rows pages them (F060). |
| `@runlith/agent-tools` | `@runlith/git` | service | git readings for workspace tools | Tools read a checkout through git. |
| `@runlith/agent-tools` | `@runlith/executions` | service+type | command work over the execution port | The shell tool runs managed executions. |
| `@runlith/agent-tools` | `@runlith/mcp` | service | web search over an MCP server | Web search is an MCP tool. |
| `@runlith/agent-tools` | `@runlith/ripgrep` | service | the search binary | grep runs ripgrep. |
| `@runlith/agent-tools` | `@runlith/source-comments` | service | comment classification for edits | An edit's comments are classified. |
| `@runlith/agent-tools` | `@runlith/utils` | service | values | Generic mechanics. |
| `@runlith/execution-host` | `@runlith/executions` | port+type | implements the execution vocabulary and the host side of the port | The host is the other side of the contract. |
| `@runlith/execution-host` | `@runlith/sqlite-process` | service | its store | The host keeps its own store. |
| `@runlith/execution-host` | `@runlith/performance` | service | host telemetry | The host measures itself. |
| `@runlith/package-boundary` | `@runlith/code-facts` | service | import readings, resolution | A boundary is measured from the imports code-facts reads. |
| `@tagma/inspection` | `@runlith/code-facts` | service | import readings for the builtins | Builtins judge the imports code-facts reads. |
| `@runlith/primitives` | `@runlith/layer` | service | the application graph | Overlays are keys of the application graph. |
| `@runlith/primitives` | `@runlith/error-boundary` | service | failure containment | An overlay contains its failure. |
| `@runlith/primitives` | `@runlith/testing` | service | test doubles on a `testing` entry only | A kit ships the doubles its consumers' suites need. |
| `@runlith/query` | `@runlith/layer` | service | the application graph | A query is a key of the application graph. |
| `@runlith/query` | `@runlith/testing` | service | test doubles on a `testing` entry only | A kit ships the doubles its consumers' suites need. |
| `@runlith/chat-ui` | `@runlith/agent` | type | browser-safe transcript, activity and tool vocabulary only | The chat renders the kernel's transcript. |
| `@runlith/chat-ui` | `@runlith/scroll-follow` | service | the following viewport | A chat follows its tail. |
| `@runlith/chat-ui` | `@runlith/utils` | service | values | Generic mechanics. |
| `@runlith/seam` | `@runlith/utils` | service | values | Generic mechanics. |
| `@runlith/floating-frame` | `@runlith/utils` | service | values | Generic mechanics. |
| `@runlith/desktop-host` | `@runlith/utils` | service | values | Generic mechanics. |
| `@runlith/dev-runner` | `@runlith/utils` | service | values | Generic mechanics. |

### 6.3.2 Server module → package: roles and grants
A server module may import:
- a **vocabulary** entry of any package, whenever its meaning uses the word;
- the **types** of any port;
- a port's **values** only as its named filler;
- a **runtime** entry only when granted — a whole package, or one named entry;
- never a **testing** entry, and never an entry restricted to other consumers, whatever general grant it holds (§6.2.1).

The registry (`ENTRIES`, `GRANTS` in `spec-06-packages.mjs`) holds the rows below.

| Package | Vocabulary | Ports (values: fillers) | Runtime granted to |
|---|---|---|---|
| `utils`, `paging`, `held`, `trace`, `files`, `source-comments` | all, or `languages` for `source-comments` | — | any module |
| `ndjson-rpc` | — | — | `external-harnesses` |
| `git` | `vocabulary` | — | `platform`, `workspace`, `graph`, `change-record`, `enforcement`, `worktrees`, `landing`, `installation`, `executions`, `composition` |
| `sqlite-process` | — | — | `platform` |
| `code-facts` | `languages` | — | `enforcement`, `graph` |
| `executions` | `protocol/*` | `CommandEnvironment`: `workspace` (what an environment backend opens) | `executions`, `installation`, `composition` |
| `performance` | `protocol`, `unit` | — | `performance`, `executions`, `composition` |
| `trace-bundle` | — | — | `native-harness`, `threads`, `performance`, `composition` |
| `llm` | browser entries | — | `providers`, `native-harness`, `composition`; `threads`: `models/normalizeModelImage` only (a neutral media entry for attachment admission) |
| `agent` | declared pure browser entries, including vocabulary-only `permissions` and `tool/display` | native storage/transition contracts: `native-harness`; common catalog/runtime/journal/inbox/resources: `threads`; Effect-native model contract: `providers` | `threads`, `native-harness`, `composition`; `providers` gets the explicit `model/llm` adapter only |
| `mcp` | `declaration`, `identity` | — | `mcp`, `composition`; `native-harness`: `mcpToolCatalog` only (adapting a server's tools into kernel tools; the pool is the `mcp` module's); `cli`: `server` only (the transport kit of `mcp-serve`, rule 5 as amended in §6.13) |
| `agent-sources` | — | — | `native-harness` |
| `agent-tools` | `workspace` | `World`, `CommandWork`: `executions`, `workspace`, `sandbox`; `WorkspaceChanges`: `change-record` | `native-harness`, `composition` (both without `world/machine`); `world/machine`: restricted to `executions`; `sandbox`: `importFile`, `WorkspaceImports`, `WorkspaceHolders`; `change-record`: `WorkspaceHolders`, `sweepProse` |
| `@tagma/inspection` | `builtins`, `verdict` | — | `enforcement` (its judges, `node/*`) |

Doors follow section 1 rule 5, as amended in §6.13: `invocation`'s `contract/service`, `platform`, and the transport kit of their own framing.

### 6.3.3 Ports packages declare, and who fills them

| Port (package) | Filled by | Contract |
|---|---|---|
| Required complete thread catalog and runtime (`agent` collaboration kit, new) | `threads` | identity/principal, lineage, authority/rights, budget, host, capabilities and truthful liveness; start/wake/deliver, continue, stop, answer/cancel and current execution, with stable keys and expected-execution fences. Completion is the selected driver's evidence; no native fallback or fabricated native row |
| `ThreadStore`, `ThreadRunStoreFactory`, fold stores (`agent`) | `native-harness` | six keyed prepare/transition/control/birth operations with source versions, store-bound units, driver fences and authoritative replay; section 2's delta verbs are their bounded apply primitives, never a bypass |
| `ThreadEventJournal`, `ThreadInbox`, `ThreadDirectoryStore`, `ThreadResourceLedger` (`agent`) | `threads` | the journal with in-unit export enqueue (section 1 v10), inbox, directory, holdings |
| Effect-native model port and explicit `agent/model/llm` adapter (`agent`) | `providers` | scoped client/call lifetime, preparation/idle/total budgets, one attempt allowance and receipts for every call form; providers supplies account, credential, egress and spend policy |
| `World`, `WorkspaceChanges` (`agent-tools`) | `executions` (machine and managed worlds, with `machineWorld` from `world/machine`), `sandbox` (guest), `workspace` (through its environment backends); `change-record` | mandatory explicit world/capabilities and supplied invocation/search/foreground budgets; durable command custody is a declared capability, never a machine fallback; change-record owns stored write reports |
| `EnvironmentBackend` (`workspace`, section 1 §1.4.3) | `executions` (host), `sandbox` (guest) | acquisition, admission, open, activate, `OpenRefused`/`OpenLost` |
| Execution port (`executions`) | `executions` (server binding); `execution-host` (the host side) | the host wire, versioned by section 2 §2.4.10 |
| Credential source, HTTP client, registrations (`llm`) | `providers`; `composition` | who signs; the catalog a product composes |
| Redactor, classification, grants (`mcp`) | `mcp` | handed in at the border and persisted nowhere in the package ([[dca0a79f]]) |

Each port with more than one implementation ships a conformance suite on the package's `testing` entry, as the kernel's adapter suites do today ([[c719285e]]). The thread catalog and runtime ports gain one.

### 6.3.4 The combined order
**Bottom-up.**
- **Packages:** `tsconfig` < `utils` < `paging` < `held` < `trace` < `ndjson-rpc` < `files` < `git` < `sqlite-process` < `code-facts` < `source-comments` < `ripgrep` < `executions` < `performance` < `trace-bundle` < `llm` < `agent` < `mcp` < `agent-sources` < `agent-tools` < `execution-host` < `@tagma/inspection` < `layer` < `error-boundary` < `testing` < `primitives` < `query` < `markdown` < `markdown-editor` < `seam` < `floating-frame` < `scroll-follow` < `chat-ui` < `dev-runner` < `desktop-host` < `window-behavior`.
- **Then** the 27 server modules in section 1 §1.5's order.
- **Then** the app and the desktop shell.

**Checked, not assumed.** `node spec-06-packages.mjs` builds one graph from:
- the 41 package relations;
- section 1's 152 relations (imported from `spec-01v10-relations.mjs`);
- every grant and vocabulary reach of §6.3.2;
- the app's and desktop shell's reaches.

That makes 682 edges over 67 nodes. The number measures the declared graph, not the architecture's quality. The script refuses unknown or duplicate endpoints and runs Tarjan's algorithm. The result:

```
{"nodes":67,"packageRelations":41,"serverRelations":152,"combinedEdges":682,"nontrivialScc":[],"backwards":[],"problems":[]}
```

It holds by construction as long as no package imports a server module: packages sit below every server module, and `apps/*` above.

Two linearizations deserve a word:
- `execution-host` above `llm` and `agent` is only a linearization: no relation joins them, and the host must never import either.
- The app → desktop reach is a type edge (the desktop's `bridge`) between two surfaces, one of which hosts the other's page. It is the only relation between the surfaces.

## 6.4 Package contracts and versioning

### 6.4.1 Where a package's contract crosses decides how it is versioned
Every Tagma process — the server, the CLI, the app bundle, the execution host, the desktop shell — is built from one commit of this repository. A package is never published on its own. So a package's contract crosses in two different ways:
- **Compile-time only:** its entries' types, its ports and its services, where no stored row or running process holds the old shape. A breaking change there is made in one commit together with every consumer; the workspace typecheck and the port's conformance suite prove it. There is no version number, no deprecation window and no alias.
- **Across a process or into storage.** These carry a format version owned by the package that defines the shape, and each follows the section that governs its skew:

| Shape | Owner of the format | Governing rule |
|---|---|---|
| The host wire (`executions` `protocol/*`, `WIRE_VERSION`) | `executions` | section 2 §2.4.10: a range, a window and carried codecs; a running host from an older build is spoken to, never replaced mid-work (F026) |
| An execution's byte record on disk | `executions` | readers outlive the host that wrote a record; the record format carries its version |
| Transcript entries and events inside a rollout | `agent` (shapes); `threads` (the file, section 1 v10) | section 2 §2.4.7: the rollout's `{format, version}` line; a newer major refuses typed |
| **The kernel's stored forms in both products' stores**: journal events (`thread_event`), entries and history items, compaction checkpoints and pruned markers, permission rules, `workflow_run` state | `agent`: each form carries its version on the record, and `agent` ships the decoders of every past version it still reads | Tagma's SQLite holds them. A breaking form change ships a decoder for the old version, or a migration in the same commit; the adapter's conformance suite reads rows of every carried past version. A row of a version no decoder carries refuses typed and is named in a finding, never read as the new form |
| Provider-native continuation receipts nested in history | `llm` owns the inner format identity/version and decoder; `agent` owns the enclosing message/event version | untagged legacy receipts are v1 only when the carried decoder recognizes their shape; an unknown inner version is never read as current because its envelope decoded |
| Credential and token files | `llm` (the OAuth token format); `providers` (the credential file) | section 2 §2.4.1: versioned, durable replace |
| The performance store | `performance` | versioned with the store; a report reads what the store's version holds |
| The execution host's own store | `execution-host` | its own migration chain (section 2, 14 migrations) |
| Answers the app decodes | the server module's `contract/wire`, carrying package vocabulary | section 4 §4.4.8: `Tagma-Contract`, the answer versions and `arms` with fallback; a package vocabulary type that enters a wire answer is versioned as that answer |

### 6.4.2 The kernel's port changes
- **The collaboration kit's ports** (section 1 §1.13's note to this section):
  - the kit gains the thread catalog and runtime ports and loses its native default behind delivery (`ThreadEnvelopes.ts:245-269` delivers through the native runner unless a participant owns the recipient);
  - Tagma fills both from `threads`;
  - this is a compile-time change, landed in one commit with both products' composition and a new conformance suite for the two ports.
- **The keyed storage protocol and bounded apply primitives** (section 2 §2.4.7 and amended §3.13.7.5):
  - `transition`, `control`, `prepare`, `transitionIn`, `prepareBirth` and `birth` own identity, immutable semantic request digest, derived plan digest, authoritative-first replay, source-version comparison and one atomic apply unit. Product-owned evidence enters through its owner's typed participant, never Tagma-specific keys/tables in the shared kernel.
  - `appendHistory`, `replaceHistoryPrefix`, `truncateHistory`, `updateColumns` and `recordRunTail` are internal apply primitives, not a second independent public mutation API.
  - Tagma SQLite, every kernel caller and the memory adapter change in one source change. Conformance covers old-sequence/run-end digest checks, repeated legitimate stale preparations, birth, rollback, spent keys and the all-old-writers/awaiting-rows migration barrier.
  - The kernel owns the port's shape, its suites, and the versions and past-version decoders of the forms stored through it (§6.4.1). Each product owns its own schema and migration chain; one row shape is never copied between two schemas without that decision (F045).
  - A form change is therefore never compile-time only: old rows stay in both stores after the commit that changes the type.
- **The kernel's lifecycle and boundaries follow [[44f7f1c3]].** Native state/folds sit below the run machine; native commands and explicit composition sit above it; evidence, context, collaboration, workflow and resources keep distinct ownership. Collaboration takes required complete catalog/runtime contracts with current-catalog admission and no native fallback. Model clients/calls/attempts have owned close and accounting; host-executed tools separate offered, admitted and permitted calls, preserve effect uncertainty after dispatch, and retain the chosen policy when unattended. Scheduling, replay, query work and cleanup have explicit owner budgets. Required readiness, external resource release and settlement stages carry durable completion obligations with their drivers; store-unit callbacks perform only store work. A pending obligation never becomes a false release or a false unaccepted mutation.
- **Browser vocabulary is its own definition.** `./permissions` resolves to pure `src/permissions/vocabulary.ts`; Bun-dependent matching is `./permissions/evaluate` in `src/permissions/evaluate.ts`. `./tool/display` resolves to pure `src/tool/display.ts`, defining `ToolDisplay` and `toolDisplayOpensByDefault` for chat-ui instead of the mixed `agent/tool` runtime. No tree-shaking assumption makes a server evaluator a browser contract.
- **The kernel's surface shrinks by meaning, not by count.**
  - `paging`'s mechanism leaves for its own package; the kernel keeps its own page families.
  - The product words in `CollaborationVoice.ts` become an argument.
  - An export with no static importer is removed only after a runtime and dynamic consumer check (F064): 38 today are candidates, not proofs.

**Model-client rule transition (A8).** [[2d2e2841]] remains binding until the scoped client API and all callers are built. At that boundary reconcile its leak-dependent wording with the accepted target: acquire one client per explicit credential/transport scope, share it with every borrower in that scope, close only after borrowers finish, and never open per call. Scope splits need different custody or policy, not extra pools.

**Secondary boundaries.** `agent-tools` takes explicit worlds and owner-supplied budgets; absent durable command custody offers no durable background promise. MCP's installed redactor applies to connect/list/call/ping failure text before publication and to structured string leaves without breaking decodability; [[42cb8372]] remains its owning task, with no duplicate kernel sanitizer. Pools follow their product declaration/secret scope. `agent-sources` invokes the kernel's workflow parser.

### 6.4.3 How a breaking package change reaches the server, the app and the CLI
- **Server and CLI:** in the same commit, by the typecheck. The CLI reads the server's catalog, not its own (section 4 §4.4.8 item 4), so a CLI of another build meets only wire skew, which section 4 governs.
- **App:** a package vocabulary type the app renders is one of:
  - part of a server answer, versioned by section 4;
  - a pure fold the app runs over such an answer (transcript entries, call progress), compiled into the same bundle the server serves.

  A page loaded before an upgrade reloads on a moved `Tagma-Contract`.
- **Execution host:** only through the host wire's range (section 2 §2.4.10).

## 6.5 The app

### 6.5.1 What the app owns, and what it must never own
The app owns everything on the screen and none of the truth behind it ([[cc59eadf]]).

It owns:
- screen state, layout and navigation;
- drafts and unsent input (persisted before a contract reload, section 4 §4.4.8);
- view models over answers;
- local marks — seams, pane sizes, the overlay stack;
- the application graph that holds them (`layer`);
- the product's words and colours handed to the kits it mounts.

It must never own a domain decision:
- whether an act is allowed;
- what a refusal means beyond showing its `unblock`;
- a thread's phase, or a worktree's state recomputed from rows;
- a model's cost;
- a setting's resolution.

Each of these is read from the owner's answer. It must never keep a hand-written copy of a wire type: section 4 deletes the 20 hand-mirrored types.

### 6.5.2 What it imports
- Server modules: only `contract/wire`, through the generated client (section 4 §4.4.7), from `@tagma/server/<module>/wire/*` (section 4 §4.4.4's `exports` pattern). Today it imports `protocol/*` and `harness/protocol` (283 imports in production files).
- Packages: browser-platform entries whose role is vocabulary or UI runtime — never `testing`, `ssr` or `node` entries. Today, in production files:
  - `layer` 190, `primitives` 37, `chat-ui` 37, `query` 28, `llm` 29, `agent` 23, `executions` 21, `seam` 13, `markdown` 7, `utils` 4, `markdown-editor` 3, `mcp` 2, `floating-frame` 1;
  - `@tagma/desktop`'s `bridge` type, 1.

  Build and testing files are counted apart: `vite.config.ts`, `scripts/dev.ts` and the test door `lib/app/testing.ts` import `@tagma/server` (4), `layer` (7), `query` (2), `primitives` (1) and `dev-runner` (1).
- Every `llm`, `executions` and `mcp` entry the app imports today is already a vocabulary entry. Its `agent/permissions` readers move to the vocabulary-only definition under that entry, while the evaluator remains server-only; chat-ui's display readers move from mixed `agent/tool` to the dedicated pure `agent/tool/display` entry.

### 6.5.3 Features aligned with the server modules
The target module path is `lib/features/<name>`; the file moves ride section 5's app renames (N-steps).

| Feature today | Target | Server module(s) it reads |
|---|---|---|
| `accounts`, `models` | `providers` | `providers` |
| `checkout` | `checkout` | `workspace` (readings, history, commits) and `change-record` (authorship, held lines) |
| `graph`, `reading` | `graph` | `graph` |
| `harness` | `threads`, with `native` and `external` sub-views | `threads`; `native-harness` (instructions, compaction, calls); `external-harnesses` (screen, speak) |
| `settings` | `settings`, with an MCP section from `mcp` | `settings`, `mcp` |
| `terminals` | `executions` | `executions` |
| `workspace` | `workspace` | `workspace` |
| `worktrees` | `worktrees` | `worktrees` and `landing` |
| `frame`, `notices` | the app's own chrome | none; notices render server refusals |

A feature imports the `contract/wire` of the modules it reads and no other feature's internals. `lib`'s one-way folder order ([[e3e9376a]]) stays and is held by `modules` rather than by one test.

### 6.5.4 The desktop shell
`apps/tagma/desktop` installs, starts and shows Tagma.
- Today it reads `@tagma/server/protocol/numbers`, `protocol/frozen` and `protocol/installation` (5 imports); the target is `installation`'s `contract/wire`.
- It lends the app one type, the `bridge`.
- It imports `desktop-host` and `window-behavior`.

## 6.7 How it is held

- **`modules` covers packages** (section 1 §1.7). The first snapshot adds:
  - each package's territory;
  - its entries (`exports`, with the vocabulary, port, runtime and `testing` classes);
  - the package relations of §6.3.1;
  - the entry roles and grants of §6.3.2.

  It refuses:
  - a package importing a server module;
  - a package → package edge the registry lacks;
  - a server module importing a runtime entry no grant gives it, or a port value it is not named to fill;
  - the app importing anything but `contract/wire` and browser-platform vocabulary or UI runtime entries;
  - production code importing a `testing` entry.

  Debt is today's cuts (§6.8), each owned by the wave that removes it.
- **`platforms`, `modules` and per-package `direction` rules hold it** ([[27d2324e]]). `platforms` judges every door on every platform its manifest declares, every app, route and worker start, and each package's refused names and loads; an unresolved reach is a violation. `modules` holds relations, territories and roles. The agent and llm floors are [[94d54cd1]] and [[fd247128]]. `checks/browserBuild.ts` holds a third party's own reach at watch after a merge ([[99b5c911]]).
- **The rules run** through `enforce_rule` at gate before `submit_work` and `merge_worktree`, and in the background over everything.
  - **What a change affects:** its entries and exports, plus the transitive set of consumers and browser closures they reach, found through a reverse index over the last snapshot of parameters and tree. A change to a low kit can break an unchanged browser consumer, so the changed package alone is not enough. Facts are reused across runs, so the whole corpus is not walked for every edit.
  - **Before it goes to gate,** section 3 §3.12 applies: its own benchmark and envelope, a bounded worker ask, an honest unjudged answer at the ceiling, and a full verdict before any output is cut.
- **Kept as they are:** the `core/boundary` contract of `#module` (section 9) and rule [[8183e6ef]] (no re-exports).

## 6.8 Mapping and control

**Moves.**
- `packages/agent/src/agent/paging.ts`'s mechanism → the new `packages/paging`. The kernel keeps its own families; `agent-tools/src/pageFamilies.ts` keeps GLOB, GREP and LISTING and loses its repeated ceiling arithmetic.
- `apps/tagma/server/src/harness/captureDriver.ts` (today in `native-harness`' territory, section 1 v10) and `harness/capturedHooks.ts` → `composition`'s test world. The driver registers as a target; the corpus location is passed in.
- `agent-tools/world` splits into the `World` port and `world/machine` (`machineWorld`). `WorkspaceChanges` splits its port type from its hashing.
- `packages/held` is created in section 3's E0.

**What the control read** (`node spec-06-packages.mjs`, snapshot of `98d8d3a216`):
- **The population:** production `.ts`, `.tsx`, `.svelte`, `.mts`, `.cts`, `.js`, `.mjs` and `.cjs` files under the 35 existing packages of §6.2.2, the app and the desktop shell, and the 891 server files of section 1's map. Tests, benches, `*.d.ts` and symlinked trees are excluded.
- **What it counts:** static `import` and `export … from`, literal dynamic `import()` and literal `require()`. It also detects relative imports that cross into another package (0 found), workspace packages outside the population (0), and entries a package does not export (0).
- **What it cannot see:**
  - non-literal specifiers;
  - stylesheet `@import`s;
  - paths a program computes at run time, such as capture's `DRIVER` and `capturedHooks`' `RECORDS` — named above from reading the code, not from the census.
- **Roles are the registry's, not yet the manifests'.** The `browser` conditions do not exist until P0. The census reads today's suite lists for `agent` and `llm`, adds `permissions`, and takes the other packages' roles from `ENTRIES`.

**The figures.**
- **38 package → package edges (724 imports).** Every one is a registry relation.
- **1,293 server → package imports:**
  - 1,199 fit the roles and grants;
  - 4 sit in fixtures, which go to `composition`'s test world: `checkoutFixture.ts`, `keyboardFixture.ts`, `sandboxFixture.ts`;
  - 90 do not fit: 28 in the doors, 62 in 22 domain edges. Each is listed below with what removes it. Three of them are test rigs in production territory that go to `composition`'s test world: `captureDriver.ts`'s `record` import, `capturedHooks.ts` and `thread/storageHarness.ts`.
- **The app's production files:** no import outside vocabulary or browser UI runtime. Its build and testing files are counted apart (§6.5.2).
- **The desktop shell** imports the server only through `protocol/numbers`, `protocol/frozen` and `protocol/installation`.

These numbers read this population at this commit. They do not prove that a browser build is safe, that a port migration is complete, or that no other relation exists.

| Edge today | Imports | Where | Cut by |
|---|---:|---|---|
| `external-harnesses → agent` | 17 | `HarnessAdoption.ts`, `HarnessBirths.ts`, `HarnessDeliveries.ts` +more | section 1 v10: the harness reaches thread semantics through `threads` and the `Harness` contract; it names at most vocabulary and port types |
| `http → llm` | 14 | `door.ts`, `auth.ts`, `credentialRefusal.ts`, `handlers.ts` | section 4 K1: sign-in and credentials become `providers`' operations; the door calls `invocation` |
| `sandbox → agent` | 8 | `sandbox.ts`, `guestImports.ts`, `PreparedTrees.ts` +more | section 1 v10: the guest resource kind and run admission are `threads`'; failures become sandbox's own |
| `http → performance` | 6 | `door.ts`, `handlers.ts` | section 4 K1: the performance operations are the `performance` module's |
| `thread-record → agent` | 4 | `db/thread.ts` | section 2 D4: `thread_record`'s columns carry neutral types; the kernel row types stay with `native-harness`' `thread` |
| `threads → agent` (testing) | 1 | `thread/storageHarness.ts` (`thread/conformance/resources`) | a test harness: moves to `composition`'s test world |
| `graph → sqlite-process` | 3 | `reads.ts`, `FreshnessGate.ts`, `MirrorBuilder.ts` | platform's typed stores and reader pool (section 2 D0) |
| `native-harness → mcp` | 3 | `mcpRule.ts`, `mcpServerTools.ts`, `ThreadContext.ts` (`McpPool`) | the pool is the `mcp` module's; the native harness asks it for tools (section 1: service) and adapts them with `mcpToolCatalog` |
| `native-harness → performance`, `invocation → performance` | 6 | `ThreadContext.ts`, `nativeOwners.ts` | the `performance` module's operations; `nativeOwners` dissolves (section 1) |
| `http → agent`, `socket → agent` | 4 | `caller.ts`, `accounts.ts`, `workflows.ts`, `threadChannel.ts` | section 4 K1; feeds are declared by their owners |
| `threads → git`, `projects → git`, `native-harness → git`, `invocation → git` | 5 | `ThreadPlacement.ts`, `Projects.ts`, `ThreadContext.ts`, `nativeOwners.ts` | preparing a worktree → `worktrees`; repository identity → `workspace`; `nativeOwners` dissolves |
| `threads → agent-tools` | 2 | `doctrine/render.ts`, `harness/commandTimes.ts` | doctrine sections contributed by their owners; command time limits are `executions`' |
| `external-harnesses → agent-tools`, `landing → agent-tools` | 2 | `cli/hooks.ts`, `submitWork.ts` (`WorkspaceChanges`) | a hook-reported write is recorded through `change-record`'s service; a landing asks `change-record` for the prepared change |
| `http → git` | 2 | `handlers.ts`, `operationBinding.ts` | section 4 K1 |
| `change-record → agent` | 1 | `checkoutRunMarks.ts` | section 1 v10: the phase event of `thread-record` |
| `landing → agent` | 1 | `submitWork.ts` | section 1 v10: carrier admission through `threads` |
| `external-harnesses → executions` | 1 | `HarnessLanes.ts` | the `executions` module's service (keys, pty), section 1 |
| `power → executions` | 1 | `AgentPace.ts` | `PaceDoor`, filled by the `executions` module (section 1) |
| `platform → agent` | 1 | `protocol/caller.ts` | the thread id brand in platform's neutral vocabulary |
| `http → executions`, `socket → executions` | 2 | `health.ts`, `terminalChannel.ts` | section 4 K1 |

`threads → llm` (`normalizeModelImage` in `ThreadActs.ts`) is not a cut: it is a granted neutral media entry (§6.3.2).

## 6.9 Rejected alternatives
- **Folding the kernel's thread model into `threads` and `native-harness`.** The kernel is the runtime agents run on. The mechanism stays in the package; Tagma's filling stays in Tagma.
- **Moving the thread catalog and runtime ports into the server.** The kit's envelope and obligation semantics are product-neutral. The ports belong to their declarer, the kit.
- **Merging the `executions` package into `execution-host`, or into the server module.** The wire is the contract between two processes built at different times. It belongs to neither side, and `performance` and the app read its vocabulary.
- **Putting `paging` in `utils`.** `utils` promises that nothing of Runlith is reachable through it and that no module does anything at import ([[690b3847]], [[130c12c0]]). The row-page mechanism serves a Tagma law ([[68659e3b]]), so it gets its own small kit — mechanism only, without anybody's families.
- **Moving every page family into `paging`.** GLOB, GREP and LISTING describe tool answers, with measured row weights and samples. A neutral kit holding them would be a central list of other owners' answers.
- **Leaving `paging` in `agent`.** Seven server modules import the kernel for a page, and `agent-tools` has already copied it (F060).
- **Keeping the capture rig in `llm`.** It makes the model wire depend on the execution host and carries about 299 MB for one maintenance purpose (F062). Consumer count alone is not the reason; the dependency and the purpose are.
- **Moving `capture/**` by the import lines alone.** The rig would still compute a path into the server and the server one into the corpus. The target contract and passed locations cut it along the product boundary.
- **A `providers` service wrapping `normalizeModelImage`.** The function takes bytes, a media type and a size limit — no provider, account or model (`normalizeModelImage.ts:31-51`) — and its caller admits a thread's attachment. A one-call facade would hide a neutral kit behind an owner it does not need.
- **Splitting `mcp`'s adaptation into kernel tools out of `mcp`.** Its meaning is "MCP servers as agent tools" ([[13756ad0]]). Without the adaptation it would be a thin SDK wrapper, and the kernel must not import MCP ([[e0d348ec]]).
- **One `modules` rule replacing `package-boundary`.** It would lose transitive browser reach over compiled output, runtime refusals and internal floors (F046, F077).
- **Browser safety declared in suites, or equated with vocabulary.** A list in a test and an `exports` map can drift, and a browser entry may run behaviour while a port may be a server-only type. Role and platform are two axes, and the conditions are the contract bundlers read too.
- **Versioning workspace packages with semver.** They are never published, and every process is built from one commit. What crosses a process or persists is versioned by its format (§6.4.1), and nothing else needs a number.
- **The app importing packages only through server `contract/wire`.** That would need re-exports, which rule [[8183e6ef]] forbids, or copies of the types. A vocabulary entry is the word itself; a server wire type refers to it.

## 6.10 Acceptance criteria

**The map is accepted when:**
1. `node spec-06-packages.mjs` answers 67 nodes, no non-trivial strongly connected component, no relation against the order and no problem, and exits zero (met, over the declared registry).
2. Over the population §6.8 names, every package → package import is a registry relation, and every server → package import fits the roles and grants, sits in a fixture bound for `composition`'s test world, or is listed in §6.8 with its cut (met for that population; the unread relations of §6.8 are named, not measured).
3. Section 5's glossary names the kernel, the host and the three `executions` owners as §6.2.3 does.

**The transfer is complete when:**
4. `modules` stands at gate over packages without debt: no package imports a server module; every edge is a registry relation; every server reach fits the roles and grants; the app imports only `contract/wire` and browser-platform vocabulary or UI runtime entries; production code imports no `testing` entry; build and testing files are held by their own entries.
5. `platforms` judges every door on every declared platform, every app, route and worker start; unresolved is a violation.
6. `llm` imports neither `@runlith/executions` nor `@runlith/ndjson-rpc`. Tagma's replay driver and `capturedHooks` live in `composition`'s test world and receive their locations as arguments. The generated files are written through explicit outputs.
7. `@runlith/paging` holds the one row-page mechanism and imports nothing of `agent`. Every family keeps its owner, rows, samples, row weight and default; the carrier envelope is passed in. Cursors keep their question identity and `cursor-stale`.
8. The collaboration kit delivers only through its runtime port and reads threads only through its catalog. Its conformance suite passes with Tagma's `threads`.
9. No shipped kernel text names a Tagma tool or concept, and `CollaborationVoice`'s words arrive as an argument.
10. Tagma's SQLite kernel storage adapter passes the adapter suites with section 2's delta verbs, and read rows of every carried past version of the kernel's stored forms.
11. The app's features follow §6.5.3 and import only their modules' `contract/wire`. The desktop shell imports only `installation`'s.
12. `agent-tools/world` exposes the `World` port apart from `machineWorld`, which only `executions` imports. `threads` imports `llm` only through `models/normalizeModelImage`, and `native-harness` imports `mcp` only through `mcpToolCatalog`.

## 6.11 Findings, claims and tasks
- **Answered here:**
  - F044, the kernel's product independence and its real surface: §6.2.2, §6.4.2, AC 9.
  - F045, the owner of the SQL ports' shape: §6.4.2.
  - F046 and F077, `package-boundary` kept beside `modules`: §6.7.
  - F060, one paging owner: §6.2.3, AC 7.
  - F061: §6.4.2.
  - F062, capture out of `llm`: §6.2.3, AC 6.
  - F064, removal only after a runtime and dynamic consumer check: §6.4.2.
- **Claims to rewrite in their waves:**
  - [[a4d3fab9]] and [[45146d74]] (the browser walk), once browser entries come from the manifest;
  - [[aa94b9c1]], once capture leaves `llm`;
  - [[3315b329]], [[8dcb5e1e]] and [[aca0e876]]: the vocabulary of `@tagma/inspection`, `files` and `layer`'s SSR entry, as the entry roles take them;
  - [[37554ef0]], the count of browser subpaths, once `permissions` joins it and `paging` leaves;
  - the `depends-on` edges of every package `#module`, from the registry (section 8 §8.5);
  - [[cc59eadf]]'s features, as they move.
- **Tasks:** one per package move (P-steps below), each owning its `modules` debt. This section opens none.

## 6.12 Build order
- **P0 (with W0/E0):**
  - code-facts' selector read by `platforms`: nested conditions, patterns, per-platform walks, and an unresolved reach as a violation (§6.7);
  - `packages/paging` and `packages/held`;
  - the `browser` export condition on every browser entry, read by `platforms`;
  - `modules`' snapshot extended to packages with today's debt;
  - `agent-tools/world` split into the `World` port and `world/machine`; `WorkspaceChanges`' port type split from its hashing;
  - `platforms` enforced at gate.
- **P1 (independent, before W4):** Tagma's `captureDriver.ts` and `capturedHooks.ts` move to `composition`'s test world and register or receive their locations; the generator writes `llm`'s five generated files through explicit outputs; `llm`'s `executions` and `ndjson-rpc` edges go.
- **P2 (with D3 and W6):**
  - the kernel's storage delta verbs in both adapters;
  - the collaboration kit's thread catalog and runtime ports with their conformance suite, filled by `threads`;
  - `CollaborationVoice`'s words become an argument.
- **P3 (with W7 and section 4 K2):** the app on the generated client over `@tagma/server/<module>/wire/*`; features renamed per §6.5.3 with section 5's N-steps; the desktop shell on `installation`'s wire.
- **P4 (after P2):** the kernel's exports reduced to what a consumer imports, each removal checked for runtime and dynamic consumers (F064).

## 6.13 The remaining questions of rule [[8dab19b6]], and amendments
1–9 are §§6.1–6.12.

10. **Contract:** §6.4. No operation id or answer changes because of this section. Package contracts are compile-time within one commit; formats that cross a process or persist carry their owner's version.
11. **Stored data:** no table moves. The formats of §6.4.1 keep their versions; the kernel's stored forms gain a version on the record and past-version decoders owned by `agent`, and a breaking form change migrates both products' chains in the same commit. Moving the capture corpus is a directory move; the history keeps the old path.
12. **Who may do what:**
    - the operator approves this map;
    - `modules`, `platforms` and the `direction` rules refuse what it forbids;
    - a loosening goes through `enforce_rule` in the open.
13. **Long-lived things:** the execution host and its wire (section 2 §2.4.10); nothing new.
14. **Bounded resources:** `platforms` is the one new consumer: it re-walks only the starts whose dependency set a change touches, reuses content-addressed facts, and is bounded by the envelope its benchmark derives ([[27d2324e]] §4.2). The capture corpus leaves the runtime package, but its size in the repository is unchanged; whether it leaves the repository is a separate decision, not taken here.
15. **Rollout:** each P-step is one commit with all its consumers. A running host of an older build is governed by section 2 §2.4.10, and a loaded page by section 4 §4.4.8.
16. **Failures:** a port or form change fails its conformance suite — including reading old rows — not production. A browser door that reaches a built-in is refused by `platforms` at landing, and a third party's own reach is named by `checks/browserBuild.ts` at watch after a merge ([[99b5c911]]). An unresolved reach is a violation, never clean.
17. **Observability:**
    - `modules` verdicts and debt per package;
    - `platforms` verdicts per start and platform, with the chain;
    - the registry script rerun in every P-step report.

**Amendment to section 1 ([[f658e190]]), rule 5.**
- **Now:** "Doors import only `invocation`'s `contract/service` and `platform`."
- **Becomes:** "Doors import only `invocation`'s `contract/service`, `platform`, and the transport kit of their own framing — the MCP server kit (`@runlith/mcp/server`) for `mcp-serve`."
- **Reason:** section 4 §4.5 gives MCP framing to `cli`'s `mcp-serve`, and framing MCP is done with the MCP kit. No other amendment to an approved section is needed.

## 6.14 What changed from v1, and why
1. **The kernel's stored forms are versioned** (Opus I1). Journal events, entries, checkpoints, permission rules and `workflow_run` state live in both products' stores. `agent` owns their versions and past-version decoders; a breaking form change migrates both chains; both adapters' suites read old rows (§6.4.1, §6.4.2).
2. **Capture is cut along the product boundary** (Opus I2, Astra P6-2). There is a recording-target contract. Tagma's replay driver and `capturedHooks` move to `composition`'s test world. Locations and generated outputs are passed in, not computed.
3. **Role and platform are two axes** (Astra P6-1). The vocabulary of `files`, `git`, `code-facts` and `@tagma/inspection` is restored; `layer/sveltekit/server` is `ssr`; `agent-tools/world` is split into the `World` port and `machineWorld`; the app may import browser UI runtime entries as well.
4. **Paging moves the mechanism only** (Astra P6-3). Families, samples and defaults stay with their owners, the envelope is passed in, and `cursor-stale` is kept.
5. **`threads` imports `llm`'s neutral media entry directly** (Astra P6-4), instead of through a `providers` facade.
6. **The control states its population and limits** (Astra P6-5). It separates fixtures, build and testing files, and the desktop shell; it counts `require`, relative cross-package imports and unexported entries; and it names what it cannot see.
7. **The gate has an execution contract** (Astra P6-6): the conditional resolver, unjudged answers, affected-consumer closure, and the §3.12 envelope.
8. **Grants reach one entry** where a module needs one (Opus minor):
   - `native-harness` → `mcp`: `mcpToolCatalog` only;
   - `cli` → `mcp/server`: a transport kit, granted as runtime under rule 5;
   - the executions environment port named for section 5's environment backends.
9. **Section 5's words:** `landing`, environment backend, `machineWorld`, `CaptureRig`.
10. **Figures:** 682 combined edges; 38 package edges, all in the registry; 1,293 server imports, 1,202 fitting, 4 in fixtures, and 87 to cut (28 in doors, 59 in 20 domain edges).
11. **v2.1** (`spec-review-06v2-arch-astra.md`): roles and entry restrictions take precedence over general grants; the `testing` role joins the registry and the script; `world/machine` is restricted to `executions` against `native-harness`' and `composition`'s `'*'`; the app's filters admit no testing entry (`layer/testing/*`, `svelte/test.svelte`). Rerun: 1,199 fit, 4 in fixtures, 90 to cut (28 in doors, 62 in 22 domain edges); the combined order is unchanged.
