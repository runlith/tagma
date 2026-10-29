---
id: 01a156d9-a73e-7045-bbfd-b087b6f7a4e0
title: "Tagma rules are one public surface: `tagma.config.ts` holds inspections and format, the graph holds the law, `@runlith/tagma` holds the contract"
ord: 56
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0d584-d0b8-7967-9796-a8e3bbddbda9
  - kind: relates
    to: 01a112cb-2f89-7056-bf19-2c0fd3e50475
  - kind: relates
    to: 01a1138f-eb48-7270-a39f-b386a1c2b760
  - kind: relates
    to: 01a1564f-f5fd-73dc-8a3d-31b0c20b1cca
  - kind: relates
    to: 01a15653-a6a0-7f9b-978d-5f88be3f8cf7
  - kind: relates
    to: 01a15666-29d3-7512-8c0c-71e28fa6e159
sources:
  - kind: file
    ref: apps/tagma/server/src/commit-steps/declaration.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/contract/wire/document.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/checker.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/enforcement.ts
  - kind: file
    ref: checks/runners.json
  - kind: file
    ref: tagma.jsonc
---
Tagma's public rule surface comes down to three things, each with one owner: the **graph** holds the law (the norm's text, strictness, triggers, debt, owners, and the link to the inspection key), **`tagma.config.ts`** in the repository holds what judges code and what rewrites it on commit, and the **`@runlith/tagma`** package holds the contract this file is written against. `{ builtin, params }` JSON in the graph, `tagma.jsonc`, `runners.json`, the `enforcement.programs` project setting, and operations with the word law instead of rules all go away. The judgement engine's insides, workers, inspection cache, Rust and performance are out of scope.

## Why

Law-lab experiments ([[b85acc68]]) showed that the road from a user's word to a check exists but cannot be walked without knowing Tagma's internals:

- [[be3f8cf7]]: to register `loads`, an agent reads the whole `read_inspections` — 51.5K characters of JSON over 8 checks, about 25K as text — and fills seven mandatory parameters, of which only `from` and `refuses` carry meaning. In the `check_law` and `enforce_law` schemas the `inspection.params` field is a bare `object`, so neither the type nor the tool schema shows the shape.
- [[c20b1cca]]: a rule with no check is not visible on the Rules screen by name.
- What judges code is currently declared in four places in four formats (below), each with its own read path and its own refusal.

## What stands now

Checked by reading code at `5f7241afeb`.

- **Builtin check** — the `#rule`'s `enforcement` document: `{ strictness, on, checks: [{ builtin, params }], debt, escaped }` (`graph/contract/wire/enforcement.ts`). The parameter shape is known to the builtin's declaration in `apps/tagma/inspection/src/packs/*/*/declaration.ts`; `enforce_law` takes `inspection: { builtin, params: Record<string, unknown> }` and checks parameters in the body (`enforcement/contract/wire/document.ts`), while inspection lists are edited by `inspection: { patch: [...] }`.
- **Project program** — `{ runner, id, params, files }` in the same document; the runner is looked up in `runners.json` (at runlith, `checks/runners.json` → `bun checks/law/program.ts`), and that file's catalog is named by the `enforcement.programs` setting, which lives in the machine database (`enforcement/programs/descriptors.ts`, `checker.ts`) and does not travel with the repository. The server gives the program the texts of its reach's changed files on both sides (`programs/files.ts`), code facts for its declared `needs` (`programs/facts.ts`), and for a whole-reach judgement only the root and the tree: the program reads git itself. Comparing against the base (`newViolations`), debt, gate, and splitting violations by line holders is done by the server (`programs/group.ts`, `judging/`).
- **External linters** — the `eslint`, `oxlint`, `ruff`, `semgrep`, `ast-grep` runners (adapters in `enforcement/programs/*`, parsing in `apps/tagma/inspection/src/runners/*`, shared SARIF parsing in `runners/sarif`), declared by the same `runners.json`. There is no universal "any command with SARIF" runner.
- **Commit steps** — `tagma.jsonc` at the repository root, the `commit` key ([[a1c2b760]]), read from the commit's own version; a git-ignored file is read from the working tree as personal.
- Tagma already runs programs with its own Bun: `checker.ts` substitutes `argv[0] = "bun"` with `process.execPath`, and the release carries its own runtime (`installation/contract/wire/layout.ts`, `RUNTIME_PART`) that starts the server.
- A program's fingerprint starts with `runner:id <sha256 of parameters and reach>` (`programs/group.ts`, `namespace`): any parameter edit changes the fingerprint and thereby detaches the debt. A single builtin's fingerprint has no prefix.
- Half the builtins are runlith law: `names` (items F1–F7, S1–S11, product prefix, services keys) and `platforms`. `call-services` and `swallowed-failures` are needed only for Effect code. Shared ones are `modules`, `size`, `loads`, `reexports`.
- Measured on this machine: enforcement documents exist at runlith (19 rules, all on gate, one check each; debt — 14 entries, all at [[6b3210c7]] through `names` F4; escapes — 0) and at polygon (1 rule, `money` runner). The other 11 registered projects have no documents.

## What will be

### Words

A rule is a norm, a `#rule` in the graph. An inspection is what judges code against a rule. Format is what brings files to the repository's shape (a formatter, `eslint --fix`). In the product, API, answers and refusals the word is rules. Operation, refusal and parameter renames are in [[ecb31b4e]].

### One config: `tagma.config.ts`

A file at the repository root, tracked by git. Its default export is `defineConfig({ inspections, format })`; both sections are "key → description" records. Keys match `^[a-z][a-z0-9-]*$`: no key looks like a number, and command order in format stays write order.

**Version.** The config in force is the one from the version being judged, as with `tagma.jsonc` today: landing `submit_work` and `check_rules over: change` — HEAD plus the session's lines; `over: staged` and the `git commit` gate hook — the index; `merge_worktree` — the merged tree; `enforce_rule` measurement and remeasure — HEAD. Another session's uncommitted config edit does not act on someone else's landing. A git-ignored `tagma.config.ts` is not read: inspections by which a gate judges a shared commit cannot be personal to one machine.

**Execution.** The config is code, and Tagma executes it with its own Bun (`process.execPath`, no auto-install) in a separate process with an empty environment, in two steps:

1. **Build.** `Bun.build` bundles the config into one script (IIFE) from the judged version's files, not from the working tree's disk: the server reads them from git and hands them to the process, the build plugin serves them from memory, and asks the server to read more for any path it was not given. The bundler's resolver sees every specifier — `import`, string `import()`, `require` — and passes only two kinds: the version's relative files and `@runlith/tagma/*`. The second comes from the SDK copy Tagma itself carries: cut lays the doors' files beside the server bundle, and the server reads them from disk ([[4c5972ca]]), so the project's `node_modules` is not needed for execution; the installed package is needed only by the editor for types. Builtin modules (`node:*`, `bun:*`) and other packages are a refusal already at build. Type-only imports are erased before resolving, so `import type` from any file is allowed.
2. **Execution.** The script runs in a fresh `node:vm` context. Only builtin JavaScript objects are there: no `Bun`, `process`, `require`, `fetch`, `WebSocket`, `crypto`, `performance` or timers, and `import()` with a computed name loads nothing. Before the script, `Date.now`, `Date` and `new Date()` with no arguments, `Math.random`, `Temporal.Now` and `Intl.DateTimeFormat` with no date are replaced with a refusal, otherwise the same content would yield different descriptions under one cache key. The process runs with `TZ=UTC`, without `bunfig.toml` and `.env` (`--config=/dev/null --no-env-file`) and with a working directory outside the checkout: otherwise the working tree's preload would execute before the sandbox. A function, symbol or non-plain-object in the result (a forgotten call, a `Promise`) is a refusal, not a silently dropped key. The result is snapshotted as JSON right after synchronous execution, so top-level await is not supported in configs: a config is synchronous data.

Any refusal and any failure of either step is `config-invalid`. This is not protection against the project: the project already executes its own commands on commit through format. It is determinism: the result depends only on content, so it can be cached, and the same version is judged identically on any machine. The schema was checked by prototype [[44117b6c]] on Bun 1.4.3 (one sample). Intercepting loads with a runtime Bun plugin (`Bun.plugin` with `onResolve`) does not work: the prototype showed it cannot see builtin modules, and a config read `/etc/hosts` through `node:fs`.

**Result and cache.** The result is data: inspection descriptions and format commands. The server decodes them with its own schemas and substitutes defaults; an inspection's identity is its description's canonical form with defaults. The cache is addressed by content: the config blob, blobs of every loaded file, every path the loader tried and missed, and the execution profile — Bun version, evaluator and SDK door texts. It lives in the checkout's git common dir, so worktrees share one entry. A cache hit means comparing the judged version's recorded blob ids for the paths, with no process started. A config that does not execute, does not decode, or pulls something forbidden yields `config-invalid` with file, line and reason.

The owner is the server's new **`config`** module (`apps/tagma/server/src/config/`, kind substrate). It reads the version, executes, caches, and answers a typed `Config`. Enforcement and `commit-steps` import its contract; neither reads the file itself (rule 51c66cb6). `set_module` writes the module card in the work on this spec.

### Config shape

```ts
import { defineConfig, Format, Loading } from '@runlith/tagma/rules';

export default defineConfig({
  inspections: {
    'domain-no-ui': Loading.forbid({ from: ['packages/domain'], refuses: ['react', 'react-dom', '@law-lab/ui', 'web'] }),
  },
  format: {
    oxfmt: Format.command({ run: ['node_modules/.bin/oxfmt'], files: ['**/*.{ts,tsx}'] }),
  },
});
```

**Builtin inspections** are description functions in namespaces by concern, the same as the Rules screen groups (`CONCERNS` in `inspection/src/core/rule.ts`):

| Function | Builtin | Screen group | Subpath |
| --- | --- | --- | --- |
| `Imports.modules(options?)` | `modules` | Who imports whom | `/rules` |
| `Loading.forbid({ from, refuses, … })` | `loads` | What loads where | `/rules` |
| `Code.noReexports(options?)` | `reexports` | How code is written | `/rules` |
| `Files.maxLines(lines, options?)` | `size` | Size | `/rules` |
| `Effect.noSwallowedFailures({ region, … })` | `swallowed-failures` | How code is written | `/rules/effect` |
| `Effect.servicesOnlyIn({ region, tags, allow })` | `call-services` | How code is written | `/rules/effect` |

Only the meaning is written; the rest is defaults. `base` is the repository root, `files.extensions` is the inspection language's every extension, `files.exclude`, `allows` and `swallowed-failures`' `allow` are empty, `reads` is `runtime`, `conditions` is empty, at `modules` `cycles`, `coverage` and `unresolved` refuse, at the `size` threshold `metric` is `non-import`. Making a parameter optional with a default is a schema edit in the builtin's declaration in `@tagma/inspection`. The schema stays the shape's sole owner: SDK types are derived from it at package build ([[d9ef0c58]]), and the server applies it when decoding. `Files.maxLines(650)` is one `non-import` threshold over everything selected; `options.by` sets a threshold by glob. Calling only describes and returns `{ builtin, params }` data; the closed server executes.

`Effect` in `/rules/effect` is a technology namespace, not a concern. `/rules` already carries `Code`, and both subpaths are imported in one file. There is no collision with the `effect` library in configs: a config cannot import it.

**Custom inspection** is two sides of the SDK contract:

```ts
// checks/law/inspections.ts — what the config imports: only the SDK and relative files
import { defineInspection } from '@runlith/tagma/rules';
import type { EffectStyleParams } from './effect-style/declaration';

export const effectStyle = defineInspection<EffectStyleParams>({
  program: 'checks/law/programs.ts',
  name: 'effect-style',
  concern: 'code',
});

// checks/law/programs.ts — the program: loads anything from the project's node_modules
import { defineProgram } from '@runlith/tagma/rules';
export default defineProgram({
  'effect-style': (input) => findingsOf(input),
  migrations: (input) => …,
});
```

In the config it is `effectStyle({ forms: ['scope-run-sync'], region: ['apps/tagma/server/src/', 'packages/'] }, { files: [...] })`. `defineInspection` declares what the server must know before running: the program module (a path from the repository root: the config executes as an IIFE script in `node:vm`, where there is neither `import.meta` nor `URL`; on Bun 1.4.3 such a script fails with `import.meta is only valid inside modules`), the name, the concern (a screen group), the needed facts (`needs: ['imports' | 'declarations']`) and, in the call's second argument, `files` — globs of what the program reads (about them in [[1553d478]]). Tagma runs the program with its own Bun through its own runner, which the server carries; the module is imported from the checkout and takes dependencies from the project's `node_modules`. The runner serves `@runlith/tagma/*` as a Bun virtual module (`build.module` of the runtime plugin), not through `onResolve`: prototype [[44117b6c]] showed that runtime `onResolve` does not intercept a bare specifier from a file on disk. Keys sharing one program module go in one process, as one checker does now. The program function is called once per key and receives `InspectionInput<Params>`: parameters and both sides at once, `tree` and `base` (`null` when measuring a whole reach with no base). Both sides are needed together: `migrations` looks for added migrations and already-landed shape steps against the base (`checks/law/migrations.ts`, `inspectMigrations`). Each side has a commit, paths to judge (changed in reach or the whole reach, as `whole` says), text reading of any path of that side (`read(path): Promise<string | null>`, the runner reads git lazily) and facts (`facts`, `null` when not declared). The function returns one reading per side: `{ tree: Reading, base?: Reading }`. A `Reading` is `findings: Finding[]` (`fingerprint`, `path`, `line?`, `message`, `value?`, `sites?`) plus `covered`: `'paths'` (default — judged exactly the submitted paths) or `'reach'` (judged the whole reach even when changed paths were submitted). What debt and escapes a reading may replace depends on `covered` ([[de05d48c]], `rules/ledger.ts` `partitionLedger`), so it stays part of the contract, as `covered` in today's `ProgramResult`. Comparing against the base, debt, gate and splitting by holders stay with the server, as now. The stdin/stdout protocol (`ProgramInvocation`/`ProgramAnswer`) stays an internal matter of the runner and the server; the author never sees it.

**Linters** are `Linters.command({ argv, output })` for any command printing SARIF 2.1 (`output: 'sarif'`) or `{ findings: Finding[] }` (`output: 'findings'`), plus named descriptions of the current adapters: `Linters.eslint`, `Linters.oxlint`, `Linters.ruff`, `Linters.semgrep`, `Linters.astGrep`. A tool description is declared once and yields inspections by tool rule: `const eslint = Linters.eslint({ config: 'eslint.config.js' })`, then `'no-console': eslint.rule('no-console')`. This replaces the "`runners.json` entry" plus "`{ runner, id }` in the graph" pair. `Linters.command` with `output: 'sarif'` also yields a tool description with `.rule(id)`, where the rule is the SARIF result's `ruleId`; with `output: 'findings'` it directly yields an inspection: such findings have no rule. The description is `{ linter: { tool, config?, argv?, output? }, rule?, files? }` data. `Linters.command` parses output with the shared SARIF parsing from `apps/tagma/inspection/src/runners/sarif`, and takes layout and unit (per-file count) as the current file adapters do. It needs no new engine.

**Format** is the current commit steps: `Format.command({ run, files, ok?, reads?, on? })`, where `on` is for now only `'commit'` (default). Order, the commit tree, delta carry into working files, and refusals stay as in [[f37610fd]]; only the declaration place and names change. A format command fails a commit only through its own failure, never because findings remain after its edits. An inspection judges: it has debt and splitting by line holders, a command has neither. So `ok` lists every code the tool uses to say "done": for `eslint --fix` and `ruff check --fix` that is `[0, 1]`, where 1 means "violations remain unfixed". Only the command's own failures refuse: `format-failed` — a code outside `ok` or death by signal, `format-missing` — no program, `format-cut` — ceiling hit. The shape admits `on: 'edit' | 'merge'` later, but this spec does not build format on edit, does not touch the comment policy, and merge commits do not go through format, as now.

### What is publicly exposed

`/rules` — `defineConfig`, `Imports`, `Loading`, `Code`, `Files`, `Linters`, `Format`, `defineInspection`, `defineProgram`, the contract types (`Inspection`, `InspectionInput`, `Finding`, `FormatCommand`, `Config`) and small helpers — only the ones runlith itself uses more than once (now one: `Files.tests`, test-file globs). `/rules/effect` — `Effect`. No `/rules/js` subpath is made. Everything shared from JS inspections stands in `/rules` by the agreed item 7, and the only JS-specific inspection, `platforms`, is internal. An empty subpath would be a door with no content; it appears together with the first inspection that is JS-specific and public.

`names` and `platforms` do not enter the SDK in their current form. The server still knows them as builtins, and runlith describes them with `checks/builtins.ts`: it builds `{ builtin: 'names', params }` data and types it through `import type` from `@tagma/inspection`. This import is erased before loading and never reaches config execution. The `read_inspections` catalog does not list them, but answers by name ([[47447c6b]]).

### Graph holds the law, code holds the inspection

The `#rule`'s `enforcement` document becomes `{ strictness, on, inspection: <key>, debt, escaped }`. Norm text, `delivery`, `enabled` and sources stay `#rule` fields and edges, as now.

- **`enforce_rule`** takes `inspection: <key>`: a string, not an object; `patch` goes away. The key resolves in the HEAD config, which the measurement follows. No such key there is the `inspection-unknown` refusal, with exits "land `tagma.config.ts` with this key" and "`check_rules` with `inspection` tries it from the change". Requiring the key in HEAD is necessary because the graph is shared: a rule pointing at a key from one uncommitted edit alone would fail every other session's landings whose tree does not carry it. Everything else in `enforce_rule` — `base`, `strictness`, `on`, `absorb`, owners, `owner`, approval on debt growth, `enforcement-stale` — is unchanged.
- **`check_rules`** takes `inspection: <key>` with a candidate rule's `blockId`. The key resolves in the change version's config: HEAD plus its uncommitted lines, the very tree a landing would judge; without session lines that is HEAD. So trying a new inspection means adding it to the config and running `check_rules` before anything lands or turns on.
- **Triggers and strictness stay in the graph.** Moving them is itself a loosening or tightening of the law, not a way of judging. `enforce_rule` writes it to the rule's journal, asks approval where debt grows, and checks the trigger against the operation catalog when writing (`trigger-unknown`), not when executing the config on someone's commit. The Rules screen and rule delivery read them from the graph without executing the config. The config says "what and how to judge"; the graph says "how strictly and when".
- **The description in the commit judges both sides of that commit.** A config edit changing a key's description is a code change, like editing the `checks/law` program today: base and tree are judged by one description from the commit version. Tightening therefore never refuses a landing for violations that already stood before it. The description's canonical form enters the rule measurement's identity: a landing that changes it makes the measurement stale, remeasure measures the rule over the whole reach, and the standing violations are recorded as that commit's escapes. `enforce_rule absorb` moves them into debt, in the open. Loosening lands, and vanished debt is removed by remeasure. Program and linter fingerprints start with the key (`<key> <program fingerprint>`) instead of the parameter hash, so parameter edits do not detach debt. Builtin fingerprints keep no prefix, as now.
- **A commit whose config lacks the key an enabled rule points at** (strictness `note` and above) is judged as an inspection that cannot execute: on gate — `inspection-failed`, naming the key and the rule, with exits to bring the key back or first move the rule through `enforce_rule`. Removing an inspection from under a gate is a loosening of the law, and it is done in the graph. Key renames go in three steps: land the new key beside the old, `enforce_rule` onto the new, remove the old.
- **One rule, one key.** Compound checks (`{ bindings }`) go away: no rule on this machine uses one. Several rules may name one key, each with its own debt.

### What the agent and operator see

- An inspection's shape comes from the `@runlith/tagma/rules` types in the editor and from `read_inspections` by name — a short signature and exits, limits on request ([[47447c6b]]).
- `read_config` (in place of `read_commit_steps`, [[ecb31b4e]]) answers what HEAD's `tagma.config.ts` declares: inspection keys with what judges them (the builtin id that `read_inspections` answers by; the `defineInspection` program and name; the linter and rule) and concern, format commands with command and masks. Rules pointing at a key are named by `read_inspections` with `key` ([[47447c6b]]): the graph's rules are enforcement's business, and `config` stands below it and does not read the graph's rules. With no config or an invalid one, the answer says why.
- The Rules screen shows every rule by name, text ones too, and an inspected rule's key ([[c3e35102]]).

## Owners and boundaries

- **`config`** (new, `apps/tagma/server/src/config/`): version reading, execution, cache, `Config`, the `config-invalid` refusal, the `read_config` operation. Imports git, `platform`, `executions` (running Bun through `ProgramRoad` under command rules, as with format) and the SDK copy. Knows nothing above it.
- **Enforcement** ([[7abcb9a1]]): document with key, `enforce_rule`, `check_rules`, judgement by the `Config` description, its own inspections' runner, `Linters.command`, fingerprint by key. `programs/descriptors.ts`/`checker.ts` in their current form go away, as do the `enforcement.programs` setting (`enforcement/settings.ts`), `patch`, and reading `entries` of list edits in `read_enforcement`.
- **Commit steps** ([[a1c2b760]]): executing format commands does not change. The declaration comes from `Config` instead of `declaration.ts`/`jsonc.ts`, which go away together with `tagma.jsonc`. The module keeps the `commit-steps` name: it is internal and still honest.
- **Inspections** ([[bbddbda9]]): builtin declarations gain defaults in schemas; implementations, parsing and judgement do not change. The `unblock` and `limitations` texts that call `enforce_law` with `patch` now speak of editing `tagma.config.ts`.
- **Graph** (`graph/contract/wire/enforcement.ts`, `graph/steps/`): the document schema and the shape step ([[ecb31b4e]] and the migration below).
- **The `@runlith/tagma` package** ([[d9ef0c58]]): contract and descriptions, no implementations.
- **The app** (`features/rules`, `features/settings`, `features/checkout`): the Rules screen, the "Format" section in settings, the commit-without-formatting button.

## Recorded decisions being changed

- [[d3e50475]], "Declaration" section: commit steps are declared in `tagma.jsonc`, a personal declaration is a git-ignored file. Why executable code instead of jsonc is not recorded there. Only the reasons for keeping the declaration a repository file rather than a setting or under `.tagma` are recorded, and they stand: the file travels with the branch, lands in ordinary commits, and is read from the commit version. The same spec left open "where the other declarations pointing at repository content live" (`runners.json` through `enforcement.programs`), and the `commit` key was made "to take them in without rebuilding". Now they are taken in, but in TypeScript. Reason: inspections need a typed shape that an agent gets from types, not from a 50K-character catalog, and a custom inspection is code; jsonc would need a separate schema and would bring back the catalog wall. Execution cost is removed by running without an environment and by the content-addressed cache. The personal git-ignored file goes away: the same inspections judge a shared gate.
- [[c3ad3db4]] renamed `enforce_rule`, `set_rule_enabled`, `check_rules` to `enforce_law`, `set_law_enabled`, `check_law` on the "operation is named after the contract" principle, and the contract is `core/law`. Returning to rules divorces operation and contract names until the next work — the renaming of `core/law` and the rest of the law word's values. Reason: the user and the agent see rules (the `#rule` tag, the Rules screen), while law is the contract's internal word. In detail in [[ecb31b4e]].
- The [[7abcb9a1]] body: "A builtin's input carries parameters as one object: the operation body checks them against the chosen inspection's schema." The input carries a key; `config` checks parameters when decoding; the module body is changed by the same edit.
- The `#rule` tag declaration (shipped software-development catalog): "enforce_law … writes the enforcement document — inspection, strictness, triggers, debt" and "a rule wrong for a class of code is changed for that class through enforce_law by the operator's word." The document carries a key, and an inspection's shape for a class of code changes in `tagma.config.ts` by the operator's word. Debt still grows only through `enforce_rule`.
- The [[6b3210c7]] body: "`enforce_law` adds it to `checks.F4.allowances`" → the allowance is added to `names` in `tagma.config.ts`.
- [[1553d478]] stays true, but `files` is now set in the inspection's call from the config, not in the graph binding. [[de05d48c]]: coverage counts by key, not by binding namespace. Both are fixed by the same change.

## Migration

One pass, with no two readers of the old and new shape. Code is migrated by hand (rule 82f10fbb).

1. **runlith**: `tagma.config.ts` with 19 keys and an `oxfmt` format command (one-to-one carry of `tagma.jsonc`). `checks/builtins.ts` — `names` and `platforms` descriptions. `checks/law/*` moves to `defineInspection`/`defineProgram`: `effect-style`, `migrations`, `ui-tokens`, `environment`, `step-places` are declared in the config, and `program.ts` with its stdin/stdout protocol goes away because the Tagma runner now holds the protocol. Each key's parameters are the ones currently standing in the rule document, unchanged, and the SDK function with defaults is used only where the canonical form after defaults matches the standing parameters. Keys are the ones the graph step derives (item 3). `tagma.jsonc` and `checks/runners.json` are deleted.
2. **polygon** (1 rule, `money` runner): the same manual carry into its `tagma.config.ts`.
3. **Graph step** in `graph/steps/` (rule a4d62ee7), in blocks and journal events, as the operation-names step (`operationNames.ts`). It translates `checks: [one check]` to `inspection: <key>`. The key is the builtin id or program check id (`modules`, `swallowed-failures`, `migrations`), and where one project has several rules with this id — `<id>-<8 hex of the rule>` (`loads-925aed1c`, `effect-style-373e29e4`). A document with several checks (none on this machine) gets key `rule-<8 hex>`. Debt and escape fingerprints of programs are rewritten from `runner:id <hash>` to `<key>`; builtins' do not change. The rule's journal keeps the former document. runlith may adopt prettier keys later through the ordinary three-step rename; this spec does not require it.
4. **Database**: a migration deletes the `enforcement.programs` setting rows; its declaration leaves the code.
5. **Order on the live server.** runlith landings are judged by the operator's installed server, not the code at HEAD. Until the operator restarts Tagma on a build with this work, the old server reads `tagma.jsonc`, `checks/runners.json` and the `checks/law/program.ts` protocol. Deleting them earlier would fail every rule program's every landing. So `tagma.config.ts` and the new inspection modules land beside the old files, and deleting `tagma.jsonc`, `runners.json` and the old protocol is a separate last landing after the restart. The graph step and the database migration take effect only on the new server anyway.
6. **A project on another machine** that has no config with the needed keys after the step meets `inspection-failed` on gate, naming the key and the rule. The former description is shown by the rule's `read_block_log`. Landing `tagma.config.ts` with the key removes the refusal by itself: that commit is judged by the config it carries.

## Out of spec

- The judgement engine's insides, workers, inspection cache, Rust, performance. The [[d9aef9cf]] study (the inspection worker's silence) is out: it is about the worker, not the surface.
- Entering the law for a new user ([[c19d5d0e]]) — a skill, a separate work.
- Format on edit, the comment policy.
- The rest of the law word's values — `read_law`/`tagma law` (the AGENTS.md section), the `law-unread`, `law-disabled`, `not-law` refusals, the `core/law` contract, the "law of the place" in delivery. That is the next work: it will bring the operations' names back into agreement with the contract.
- The operation's place — [[8fa6e159]]. This is the precondition of the law-lab scenario from another project's thread ([[7769efcd]]); acceptance runs the scenario in its own project.
- Publishing the package to npm — the operator's step, not an acceptance criterion.

Work standing under [[7abcb9a1]] and [[bbddbda9]]:
- [[50f3baec]] survives: a module of its own inspection still loads from the checkout with its `node_modules`. Only the config is read from the version.
- [[e07f5cc7]] survives: the `config-invalid` and `inspection-unknown` refusals carry their own exits, and the task is about inspection failures.
- [[360184df]], [[b07cc691]], [[83c2055b]], [[4799e983]], [[5a61c757]], [[da1d3baa]] — survive: engine and debt accounting.
- [[288197fd]] survives: `built` at `loads` appears in `Loading.forbid` options with the same schema.

## Why so

- A description in the graph as JSON was rejected on the [[be3f8cf7]] experience: neither the agent nor the tool schema sees the shape, and a parameter edit needs a graph operation plus the catalog. Code in the repository gets types, diff and review for free.
- Separate files for inspections and format were rejected: two version readers, two caches and two shapes for one task of "what the repository declares to Tagma".
- Reading the config from the working tree was rejected: a neighbour's unfinished edit would judge others' landings. The commit version already stands for `tagma.jsonc`.
- Triggers in the config were rejected for the reasons above: moving them changes the law, which the graph records and approves, and a config on someone else's commit executes too late to check an operation name.
- Tightening through the config with landing refusals — judging the base by the former description — was rejected. Then `enforce_rule` could not measure a not-yet-landed description, and there would be nothing to record new debt with before landing. There is no refusal today for violations that stood before the commit, for programs either.
- Executing the config with the project's `node_modules` was rejected: judgement would depend on the installed package version and on network at auto-install, and a project without JS would need `bun install`.

## Acceptance

Proven by the implementer:

1. **runlith law does not change.** On one code commit, before and after the move, `check_rules over: all` over each of the 19 rules yields the same violation set: for programs the fingerprint is compared after namespace. After the first remeasure: at [[6b3210c7]] the same 14 debt entries with the same fingerprints, owners and values, no debt elsewhere, 0 escapes everywhere. The result is recorded in the task.
2. **law-lab scenario** (integration test on a fixture repository with `packages/domain` and `packages/ui` layers and a rule sourced at `packages/domain`):
   - the `domain-no-ui` key in an uncommitted config; `check_rules { over: 'change', inspection: 'domain-no-ui', blockId }` finds `packages/domain/src/summary.ts -> @law-lab/ui` in the uncommitted `summary.ts`;
   - `enforce_rule` with this key before the config lands refuses `inspection-unknown`;
   - after landing the one config, `enforce_rule { inspection: 'domain-no-ui', strictness: 'gate', on: [submit_work before] }` writes a rule with no debt;
   - `submit_work` of `summary.ts` refuses and names this fingerprint.
3. **Description in the commit**: a landing that tightens a key's description lands, and after remeasure the standing violations are recorded as that commit's escapes; a landing whose config lost a gate rule's key refuses `inspection-failed` with the key.
4. **Schemas**: in the tool catalog, `inspection` at `enforce_rule` and `check_rules` is a string; `enforce_rule` has no `patch`.
5. **Config execution**: a second landing with the same config content and imports starts no process — the hit is visible by the `config` module's span; editing the imported file starts it again. A config calling `fetch`, `Date.now()`, `Math.random()`, reading `process.env`, importing `node:fs` or `typescript` (even through `require`) gets `config-invalid` with the place.
6. **Format**: the current commit-steps tests pass with the declaration in `tagma.config.ts`.
7. **Names**: searching the repository outside `archive/`, the graph, the graph steps and the migrations that translate old names finds no `tagma.jsonc`, `runners.json`, `enforcement.programs`, `enforce_law`, `check_law`, `set_law_enabled`, `set_law_delivery`, `read_commit_steps`, `commit-step-`, `withoutSteps`. Standing graph blocks — features [[841d0f08]], [[332b5b81]], [[58074d0c]], explanations and rule bodies above — speak the new words.
8. Package, catalog and screen — by their own specs' acceptance: [[d9ef0c58]], [[47447c6b]], [[c3e35102]].

Order: [[ecb31b4e]] → [[d9ef0c58]] → this spec → [[47447c6b]] → [[c3e35102]].
