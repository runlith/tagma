---
id: 01a0e0bd-9783-76fe-9ee0-e0873c5891f4
title: The Tagma server is cut into domain modules, each owning its data and entered only through its contract, in an acyclic order; the thread splits into a low record and a high life
ord: 49
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
# Tagma architecture spec · Section 1. Modules — draft v7

**v7 = v6 + the fifth round (`spec-review-01v6-arch-*.md`) + appendix C (`module-map-v6.md`): a fresh AST measure of the target model — 25 modules, 154 edges, 0 SCCs, 0 back edges.** The zero refers to the target model; in today's tree the old imports and `Deferred` stand until implementation. The build conditions that an import measure does not see are listed in §1.4 (rule 9) and appendix C §6, and become acceptance criteria of the waves.

History: v1–v3 went bottom-up (lay the files out, cut the imports) and ran into a cycle in the middle. v4 designed the middle top-down (thread = low record + high life). v5 added an honest measure (appendix B, `module-map-v4.md`) and nine decisions. v6 corrects what the fourth round (`spec-review-01v5-arch-*.md`) found wrong: the owner of the `thread` table, the fates of the late bindings, the order, the wave protocol, the place of `check_rules`, catalogs and system tags. The register of all findings about the code is `spec-findings.md`.

**Section 1 is boundaries only.** Moving a module is a rebuild according to sections 2–5 (data, execution, contract, names) and to its card (section 7), not a transfer of files.

## 1.1 Problem
- 891 production files in the server, 151,951 lines; 55.4 % of commits over 30 days touch ≥2 directories.
- Today's files, laid out by domain, are one strongly connected component of 20 of the 21 modules. Point cuts (v3), counted honestly, leave a cycle of 7 modules around the thread: the lower domains read facts about the thread and reference its table, while the thread's life depends on all of them.
- The central lists and build roots (`Stack.ts`, `http/runtime.ts`, `OPERATIONS`, `HTTP_OPERATIONS`, `VERB_SOURCE`, `CAPABILITY_IDS`, `SETTING_KEYS`, the server's `exports`) are edited by every operation; the call context is assembled in several places, each differently ([[37439dcf]]).
- The graph core mixes its own vocabulary with the vocabulary of the `code-project` catalog (§1.3).

## 1.2 Model — top-down

### Entities, scenarios and owners
| What | Owner | Why |
|---|---|---|
| **Thread record**: identity, project, parent, name/title, facet, origin (adoption), archive, pin, current native run (`runningRunId`), **published phase `running | idle | failed`** (activity of both the native run and the CLI session), `ownerId`, `spawnRootId` | `thread-record` (low) | a fact everyone references; `change-record` no longer reads the execution status — the phase is enough for it (`WorkspaceChangeLog.ts:899,960,973,1111,1475,1525`), plus `runningRunId`, the name, `ownerId`, `spawnRootId` from the record |
| **Thread life**: the execution row (prompt, status, model, rights, waiting, context), runs (`thread_run`), transcript, instruction delivery, compaction, agent assembly, capabilities → tools | `threads` (high) | drives the workspace, execution, law, knowledge |
| **Workspace**: roots, repositories, project coverage, assignments/generations, checkout status, environments, copying of ignored files | `workspace` | where work stands |
| **Authorship**: records, observations, held lines and their count, discharge, stamped paths; the event `heldChanged(threadId)` | `change-record` | above `workspace` |
| **Execution**: commands, terminals, custody, lanes, execution worlds, the terminal adoption contract | `terminals` | |
| **Law**: rules, checks, debt and the commit queue; the judgement services `judgeTree`, `judgeStaged`, `judgeHead` in its `contract/service` (amended by section 4 §4.11) | `enforcement` | |
| **Work delivery**: landing (`submit_work`), `check_rules` whole (`change`, `staged`, `all`), calling enforcement's judgement services, worktree life, merge, finishing | `worktrees` | one mechanism for landing and merging |
| **Thread birth** (spawn, adopt, fork) | a coordinator in `threads` | creates the record in `thread-record`, asks for placement, reserves, admits to execution |
| **Operation execution**: calling the body, rule triggers before/after, the operation's execution context | `invocation` (new; not `operations` — that name is taken by the catalog of bodies) | a neutral executor; domain refusals (of terminals and others) arrive as the owners' contributions |

### The `thread` table — a cut by columns
Today the `thread` row is an **execution** row (`db/thread.ts:45-90`, types from `@runlith/agent`, `@runlith/llm`); it is written by `threads`, `cli-sessions`, `files/*`; lower modules reference `thread.id` (`db/assignments.ts:10,25`, `db/commandRules.ts:11`, `db/terminals.ts:54-55`, `db/sandbox.ts:16`).
- `thread-record` owns the **record row**: the columns from the table above. `thread_live_spell` is life and stays with `threads`.
- The `thread` execution row and the delivery fields in `thread` (`contextEventId`, `contextFindingId`, `worldStateSnapshot`, `delegation`, `projectionEvictedAt`) belong to `threads`.
- The lower modules' foreign keys move to the record's key; the cascade is a chain. The migration of the four tables and the storage shape are section 2.
- The phase is written by the same units that write `status` today, for the native run and for the CLI session (including `HarnessSessionStore.ts:70`). `runningRunId` is written by the same write unit that creates/finishes/stops/interrupts/cuts the run (today `ThreadRunLedger.ts:409-416` already writes the run and the status in one unit); it is reset by comparison with the expected id; `null` outside a native run (not a CLI session id). `HarnessSessionStore.migrate:170-188` must update the fact.

### Order (bottom-up, per appendix B §4 + v6)
`clients` < `platform` < `accounts` < `settings` < `graph` < `catalogs` < `installation` < `thread-record` < `workspace` < `change-record` < `power` < `mcp` < `artifacts` < `terminals` < `enforcement` < `performance` < `worktrees` < `threads` < `cli-sessions` < `sandbox` < `invocation` < the doors `http`, `socket`, `cli` < `composition`

The `composition` root is the very top: it imports the modules and the doors, assembles the manifests, and contains the process entry points (`http/main`, `cli/main`) and the fixtures that assemble the whole runtime.

## 1.3 Graph core and catalogs
- The core (`graph`) knows only **roles** (claim, work, decision, law, container, observation…) and **its own system tags** `#tag`, `#catalog`. `#reflection` (friction with Tagma itself — not about code) leaves `code-project`; where exactly it goes is a question for the operator (§1.8).
- A catalog is content: the project's vocabulary. `code-project` (`#module`, `#area`, `#claim`, `#decision`, `#task`, `#rule`, `#idea`, `#research`) lives in the `catalogs` module; `graph` does not import it. Catalog contents are passed to the core **as an argument** (the root assembles them; a project-scope catalog selection — a set, or a return to inheriting — is ordered by a project request in the machine store, compared-and-set against the applied revision and fencing the project's automatic activations while pending, and activated in the one graph unit that installs the catalog in the checkout the write goes through; a settle unit then applies the request to the machine setting row, and a driver completes a pending request by its act id; a concurrent loser is refused, typed; other checkouts of the project, and every project following the user-scope value, take the applied set as section 9's automatic update; project birth writes the machine `project` row with a birth intent, and the new graph store's first unit installs the vocabulary, and the project is not served before it — amended by section 2 §2.12, [[70083b67]]); the allowed values of the catalog setting are a contribution to the settings registry through the manifest (`protocol/settings.ts:11,835-841`).
- `#view` and `#proposal` are catalog declarations; their mechanisms (`Reading.savedQuery`, `Review.amendmentTag`) are in the core and work by roles (reviewers' decision 2:1; [[8542709b]]).
- Violations today: `#reflection` is declared in `protocol/tags/codeProject.ts:98`; the spec brief finds blocks by the tags `area/research/claim/task/idea/decision` (`graph/orientation/Orientation.ts:960-1023`) — it moves to roles; the default catalog `code-project` in `protocol/settings.ts:841` — the installation chooses it, not the core.

## 1.4 Module and rules
### Shape
```
<module>/
  contract/wire/     browser-safe: schemas, events, read models, public types
  contract/service/  server ports and services for other modules
  <module>.ts        build surface: one or more ordered Layers + contribution manifest
  …                  internal
```
A module may export several ordered Layers (early stores, a late facade) — this is how the `ForeignSessions` port is acyclic at build time.

### Rules
1. **Consumer → entry**: a domain module — a neighbour's `contract/`; the root — `<module>.ts`; the application — `contract/wire/`; tests — their own module, the neighbours' `contract/`, declared test entries.
2. **Dependencies are an acyclic `depends-on` graph**, checked against the imports of the assigned files.
3. **Breaking an upward dependency**: manifest (the root collects the modules' contributions: the edge `composition → module`); argument; event (the owner publishes, the lower module does not know the subscribers; it breaks a cycle only if the scenario is cut; atomicity is lost — so only for projections and notifications); port (the lower module declares it, the upper one implements it; allowed when the graph of concrete services is acyclic); split; type. A read model and a test entry do **not** break an edge.
4. Floors inside a module and the module's boundary are different checks.
5. Doors import only `contract/`; each declares its own narrow dependency set (`HttpDeps`, `SocketDeps`), and the root passes the services.
6. A scenario across several modules belongs to a named coordinator; a coordinator may hold one transaction if it has declared its tables and they are all in one DB file (details — section 2).
7. Call context: the owners of the scopes are `installation` (installation), `workspace` (the served checkout), `threads` (run), `invocation` (operation call); a required unbound capability is a build error.
8. The root is one typed union of manifests; all central lists and `exports` are derived from it; "declaration ↔ body" completeness is a compiler check ([[0342c0ff]]).
9. **Late binding between modules** (`let`/`Deferred` in the root) is forbidden, except for **two-phase start**: a module is built without its upper services and **itself declares the port** for what it will receive; after the build the root calls its `start(implementation)` before work is admitted (admission). Before `start` the module **explicitly refuses** (as "The Tagma stack is still assembling" does today, `Stack.ts:454-457`, except that the owner is the module); waiting until `start` is not allowed. The module's background fibers do not admit work that needs the port before `start`. Readiness and the release of the phase are an acceptance criterion of the wave (not proved by an import measure).

### Four late bindings
| Case | Where | Fate |
|---|---|---|
| `markHeld` | `http/runtime.ts:354-355,533`; the mark is set by the journal (`WorkspaceChangeLog.ts:315,1693-1716`, `submitWork.ts:249`) | the `change-record` event `heldChanged(threadId)`, subscribers `ThreadList`, `ThreadFiles` (`threads → change-record`). A signal without data, the count is computed on read — no outbox is needed. `graph` knows nothing about the thread; the `discharge` port of `graph` is implemented by `change-record` |
| `naming` | `Stack.ts:570,830,922`; `observations → naming.published` | CLI observations write the title into `thread-record` (`titles.adopt`, `HarnessObservations.ts:482-483`); the record publishes "title recorded"; subscribed are `threads` (publication, announcement, meta) and `worktrees` (provisional branch). Branch renaming — an argument downward |
| `takingBack` | `terminals/terminalsLayer.ts:76,345` + `Stack.ts:1057`; `CommandWaiters.ts:81-84` waits for the answer in the same write unit | **the port `NoticeTakeBack` with a transactional answer, declared by `terminals`**, implemented by the full `retractSignal` (`ThreadAggregate.retract:619-634`: a durable retraction + clearing `runInbox` in memory); the root calls `terminals.start(takeBack)` before `commandDelivery.attend`. Event/outbox are excluded: they lose the atomicity of the discharge. Decided unanimously |
| `owners` | `Stack.ts:454,1342`; `ThreadContext` hands the whole set of owners to the tools (`ThreadContext.ts:75,98,192` → `nativeOwners.ts:72,107` → `nativeTools.ts:168-175`) | **the port `ThreadExecution` is declared by `threads`** (an opaque executor of operations — today already the port `NativeCatalog`, `harness/nativeCatalog.ts`); `invocation` implements it (the edge `invocation → threads`); the neutral call types are in `platform`; the root calls `threads.start(execution)` before admission. The root's union is not imported. A call-time cycle is legal; a build-time cycle is not |

## 1.5 Map (measured)
The "path → module" assignment is appendix A (`module-map-v3.md`) + the corrections of appendix B §2 + v6: `thread-record` by columns (§1.2), `invocation` instead of `operations`, `check_rules` → `worktrees` whole, no port, `catalogs` (§1.3), `Store` receives the DB path and `seedDirectory` as an argument.

**The nine back edges of the honest measure and their resolutions** (B §4; confirmed by measure C — after them and the v6 corrections the target model has no SCC):
| Edge | Resolution |
|---|---|
| `platform → installation` (`db/Store.ts:14`) | `installation` chooses the path and `seedDirectory`, the root passes them |
| `platform → graph` (`protocol/caller.ts:3`, `currentProject.ts:3`) | a neutral reference to the project and the actor at the bottom; `ProjectCall` belongs to `graph` |
| `platform → workspace` (`protocol/caller.ts:4,50`) | the actor without `WorkingOrigin`; "a call in a workspace" is a `workspace` contract |
| `enforcement → worktrees` (`operations/enforcement.ts:14`) | `check_rules` belongs to `worktrees` whole; the edge is `worktrees → enforcement` (contract), and no reverse edge remains |
| `threads → cli-sessions` (`Stack.ts:829`) | `naming` through the record (table above) |
| `invocation → composition` (`operations/perform.ts:12`) | the catalog of executions is an argument of `performById` from the root; `OperationId` is a type in `platform` (section 4) |
| `http → composition` (7) | `HttpDeps`; the whole-runtime fixture is in `composition` |
| `socket → composition` | `SocketDeps` |
| `cli → composition` (2) | starting the server and assembling the test world belong to `composition`; `serve` receives the launcher |

Outside the server: `packages/execution-host` is its own `#module` (five owners inside; the zone [[6c81c6f3]] moves over); the `packages/*` that Tagma uses are modules with `entries` = `exports`; the application's features are aligned with the modules.

## 1.6 What holds it
### Law
- **One `modules` rule at gate from day one**; everything as it stands today is debt, and the owner of each entry is a wave task.
- The day-one snapshot comes from table A + the B corrections + v6, not from the graph (`#module` today accepts only `dir`, while the map assigns files inside 12 mixed directories). As the move proceeds the directories become homogeneous, and the snapshot is materialized from `#module`.
- The day-one entry of a module is the whole module (`entries: any`); after the wave — `contract/` (a tightening).
- A new file in a mixed directory goes to the directory's default owner.
- Debt: `<consumer-module> -> <target>` + a set of violating files; a new file outside the set is **always refused at gate**; replacing a violator is refused. Growth of the sets as a watch signal loosens nothing.
- **An unresolved in-project import is refused for runlith** (`unresolved: refuse`); today `direction` marks it unjudged without refusing (`direction.ts:89`). For another project it is a parameter.
- The module's inner floors — `direction`, `base` = the module's directory.

### Waves and the floors rule [[f49f228f]] — three questions to the operator, known in advance
Per `direction.ts#tightens:62-66`, a new top-level entry is a tightening on any floor; reordering or removing an entry is a loosening. Therefore:
- modules with new directories (`thread-record/`, `change-record/`, `cli-sessions/`, `sandbox/`, `composition/`, `workspace/`, `installation/`, `catalogs/`, `invocation/`, `clients/`) are placed on their target floor **without a question**;
- **question 1:** raise `worktrees/` above `files/`, `enforcement/`, `terminals/` (landing imports `files/{ShadowGit,replay,discharge,attribution}` — floor 12, while `worktrees/` is 11);
- **question 2:** lower `terminals/` below `enforcement/`;
- **question 3:** at the end, remove the emptied entries (`harness/`, `protocol/`, `db/`, `working/`, `workspaces/`, `files/`, `thread/`, `api/`, `projection/`, `doctrine/`, `install/`, `ai/`, `skill/`) and the rule itself, once every path is covered by modules.
The `thread-record` wave comes after the tables that reference `thread.id` (`db/{assignments,commandRules,terminals,sandbox}.ts`, floor 5) have moved into their modules; until then `db/thread.ts` remains a file territory inside `db/`.
The order of leaving `harness/` (Fable): first, down, the files of modules below `threads`; then new entries above 16; last, the remainder → `threads/`. `siblings` is not switched.

### What the engine lacks (neutral: any project and language)
A built-in `modules`, replacing the doctor's `dependency-undeclared` ([[fec11fb8]]):
- the map snapshot in the parameters, through `enforce_rule`; a graph edit does not change the law; the doctor reports the divergence; a change of the snapshot is a run over the whole reach;
- tightening without a question: an edge removed, an entry narrowed, a path previously measured by no one; everything else is a loosening ([[5134ddcf]]);
- node selection by roles, not by the literal `#module`;
- the parameters `entries` (per consumer), `cycles`, `coverage`, `unresolved`, `files`, `reads`;
- nested territories — the deeper one owns; an overlap at one level is a refusal of the snapshot;
- debt with a set of files; the affected consumers of changed `exports`/entries/territories; the verdict distinguishes "checked" from "not measured";
- **debt follows the same violation**: when a file moves, a debt entry passes to the new path only if, under the law's snapshot, the consumer module, the resolved target and the kind of violation are preserved (a git rename and non-growing specifiers are not enough: after the move a relative import may point at a different target); otherwise it is a new violation;
- language through an adapter (`code-facts`, workspace packages [[27eba453]]); today there is one adapter (JS).
`package-boundary` is not removed entirely (browser safety, SDK bans, the inner floors of packages are separate rules).
Separately: the rule "the graph core names no catalog tags" is a project program or a future `names` check.

### What a check cannot hold
Whether the cut is right is a reviewer's judgement. Signals (watch): `owner-spread`; module size (guideline 10–40 thousand lines; `threads` 32, `graph` 31 — at the upper bound); growth of the debt sets; edits to the root and the doors for the sake of other modules. The success metric is the share of commits touching ≥2 modules (today 55.4 % by directories).

## 1.7 Readiness
**Map accepted:** appendix C — 0 SCCs in the target model (done); the scenario owners of §1.2 are named; the fates of the four late bindings are chosen; the three questions per [[f49f228f]] are listed.
**Move complete:** `modules` without debt; no uncovered paths; [[f49f228f]] removed; a new operation touches only its own module's files (doors, root, `package.json` — zero lines; requires section 4); the build conditions of appendix C §6 are met (two phases of the `threads` Layers, `start` before admission, the record's phase in one unit for native and CLI, title publication with a subscription before admission or replay, the physical cut of the `thread` row and the FKs); negative cases are refused: a private import, an uncovered file, a cycle, a changed export with a consumer, another module's build entry, **an unresolved in-project import**, a new violating file while debt exists, a call to a module before `start`.

## 1.8 Handed to other sections
- `check_rules`: decided in section 4 §4.4.9 ([[d925fa0c]]) — the whole operation in `worktrees`, no port.

## 1.9 Open questions
Closed in v7: the composition of the thread record (phase + owner + spawn root; measure C confirmed that the lower readers need only the phase), `takingBack` (two-phase start of `terminals`, unanimous), `#view`/`#proposal` (catalog, 2:1).

- **For the operator: `#reflection`.** (a) a core system tag beside `#tag`/`#catalog`; (b) the role "observation", with the tag declared by a catalog (Opus); (c) a shared Tagma catalog not tied to code (`#reflection`, `#view`, `#proposal`), installed into any project separately from `code-project`, with the core working by roles (recommendation). In every variant `#reflection` leaves `code-project`. Measure C proved 0 SCCs for variant (a); under (b) and (c) `graph/work/Reflection.ts` must move from the tag literal to the role "observation", otherwise an edge `graph → catalogs` appears.
