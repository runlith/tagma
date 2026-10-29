---
id: 01a0d54f-98aa-710d-b3fe-bb7cae56a980
title: "Architecture as law is built from three components: a facts kit, a pure judgement package, and a server module that owns the product"
ord: 35
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d4db-9d34-7461-807d-8775f5648cf9
---
The component map every slice of [[f5648cf9]] builds into. It states who owns each part, which way dependencies point, what runs where, and where data lives. Slices build parts of these components; none draws a new component without changing this decision first.

## Components

```
@runlith/code-facts   packages/code-facts             kit, no product meaning
        ↑
@tagma/inspection      apps/tagma/inspection            Tagma's law as pure code
        ↑                         ↑
server enforcement/   apps/tagma/server/src/enforcement   the product: graph, doors, workers, driver, store
                                  ↑
server protocol/ (vocabulary door) · harness/submitWork (gate) · working/ (merge gate, through a port) · cli/ (`tagma check`)
```

### 1. `@runlith/code-facts` — facts about code, read from trees

**Owns:**
- reading facts from source texts per language: imports now; exports, declarations and names when a builtin needs them;
- resolving a relative specifier against a tree's listing;
- the reverse import closure (which files a change reaches);
- queries over those facts with no rule in them, the first being `floorCrossings` (which edges cross a floor table);
- memoising by blob id.

A tree is a port — list paths, read a text by path — so the kit reads git objects, a disk, or a plan's proposed files alike. TypeScript comes first, through the compiler; other languages arrive through tree-sitter behind the same interface.

It knows nothing of rules, graphs or Tagma. It lives in `packages/` because more than Tagma consumes it:
- `package-boundary`, whose `imports.ts` moves here and which then reads through it;
- `@tagma/inspection`;
- the doctor's `dependency-undeclared`, whose regex reader in `graph/measure/imports` it replaces in the slice of the core builtins;
- test selection.

**Why a kit and not `package-boundary`:** `package-boundary`'s test drivers die with the migration, while the facts outlive them. One reader for every consumer keeps two answers about one tree from disagreeing ([[03f113a2]]).

### 2. `@tagma/inspection` — judging a change, as pure code

**Owns:**
- the builtin inspections: their ids, parameter schemas, stated limitations and implementations;
- the judgement: facts on both sides, minus the base, minus the debt, to a verdict;
- the program contract for project inspections — input, output, versions, SARIF decoding;
- the debt and escape arithmetic.

It holds no graph, store, server service or process spawning: rules, debt and trees come in as values.

It has two doors:
- a browser-safe **vocabulary** door (ids, schemas, the contract's shapes), read by the server's `protocol/` and by SDKs;
- a Node door with the implementations, loaded only inside the server's workers and by the CLI.

It is a package in Tagma's tree (`@tagma/…`, per the repository's law) for two consumers that must not depend on `@tagma/server`: a project inspection's SDK needs the contract, and `tagma check` needs the judgement without a running server.

### 3. The server's `enforcement/` module — the product

**Owns:**
- the enforcement document's acts (`enforce_rule`) and reads (`read_inspections`, `try_inspection`, `inspect_work`);
- the judgement at landing and at merge, reached through ports;
- the post-landing driver: re-measure, retire debt, record escapes, and run layers at watch;
- the two inspection workers that host `@tagma/inspection`'s implementations;
- running project programs through a port the `terminals/` module fills;
- the budgets, as settings;
- its own store.

It is the first Tagma module built in the target modular form: its own contract, its own data, and its own Layer carrying its drivers. It is composed as one entry, not wired into `Stack`.

### 4. Doors

- `submit_work` and `merge_worktree` call the judgement through a port. `working/`, on a low floor, declares the port.
- `tagma check` is a CLI verb. It reads rules and debt from the graph's files in `.tagma`, reads the tree from git, and runs `@tagma/inspection` in its own process, so CI, hooks and commits made outside Tagma are judged by the same law.
  - Without a change record, every line counts as the committer's own.
  - Without the execution host, programs run as ordinary child processes.

### 5. Tests

- **Runner.** The layer runner is project content: for runlith, its test infrastructure beside `test/residue.ts`, owned by the test-layers decision. Tagma owns only the contract the runner speaks and the points it runs at.
- **Selection** is a query of `@runlith/code-facts`: the reverse import closure, plus the layer rule's declared non-import inputs that fall back to a whole package.
- **The result cache** lives in `enforcement/`'s own store. It is one per machine, shared by every worktree and session, and keyed by the content of a test's inputs:
  - the test file;
  - its import closure;
  - the declared non-import inputs;
  - the runner's version.

### 6. Setup agent, packs and SDKs

- **The setup agent** is an agent definition in Tagma's library. It learns from `read_inspections`.
- **Packs** extend the catalog installer. Their format is their own decision.
- **SDKs** are libraries over `@tagma/inspection`'s vocabulary door: TypeScript first, a Rust crate next.

## Data

| What | Where | Why |
|---|---|---|
| A rule's enforcement document | a field of the rule, in the project graph | It travels in `.tagma`, is journaled and needs no migration ([[64798cd8]]). |
| Test results and the parse memo | `enforcement/`'s own SQLite file beside the machine store | These are write-heavy, derived and disposable. Keeping them off the machine store's single writer means losing the file loses only speed. |

## Runtime

- **Builtins** run in two worker threads of the server:
  - one for landings, merges and `inspect_work`;
  - one for whole-reach jobs.
- **Project programs and test layers** run as admitted commands on the execution host, whose limits and stop ladder bound them.
- **Trees on disk.** A program that needs files on disk gets a tree the engine materializes: a detached worktree of the judged tree, readied by the project's worktree setup ([[06ae746e]]). No project's runner builds its own ([[50467aad]]).
- **`tagma check`** runs in its own process.
- **The landing path** is bounded by the landing budget. Whole-reach work never runs inside a landing permit.

## Rejected alternatives

- **Nx or Turborepo for test selection and caching.**
  - They select and cache per package task, but runlith's cost sits inside single packages: the server is about 240k lines, the kernel about 73k. A package-level hash changes on nearly every commit there.
  - They would bring a second dependency graph beside `code-facts`.
  - Turborepo reads JavaScript workspaces only, and Nx other languages only through plugins, while the product must stay language-neutral.
  - Their remote caches serve many machines, and Tagma is one machine.

  Worth taking are their ideas: named inputs, content hashes that include environment and tool versions, and outputs replayed from the cache. A project that already runs Nx or Turborepo keeps it: its layer runner can call them and report through the program contract.
- **The judgement inside the server module only.** `tagma check` and SDKs would then depend on the server, or copy the judgement.
- **Facts inside `@tagma/inspection`.** `package-boundary`, the doctor and test selection would then read code through Tagma's law package, or keep their own readers.
- **Test results in the machine store.** Every test result would queue behind the writer that every thread and terminal already shares.

## Order

- The slices keep the order of [[f5648cf9]].
- [[be584b76]] builds the first parts of all three components: `code-facts` with TypeScript imports and tree resolution, `@tagma/inspection` with `direction` and the judgement, and `enforcement/` without its store.
- The store arrives with the slice of affected tests and the cache.

## Spec-list questions

This decision answers:
- 1: the components;
- 4: the target model;
- 5: owners and boundaries;
- 6: rejected alternatives;
- 9: the order;
- 11: data placement;
- 13: long-lived things — workers, the driver;
- 14: bounded resources — budgets, workers;
- 16: failures — losing the result store loses only speed.

out: 2, 3, 7, 8, 10, 12, 15 and 17 — each slice answers them for the part it builds.
