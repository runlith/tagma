---
id: 01a0e3ac-ccfa-7bd9-99dd-ee7c243fd181
title: "Every Tagma name follows meaning: one word, one meaning, one owning module; files are named for the one concept they hold; the names builtin holds the rules at gate with today's violations as debt the waves retire"
ord: 56
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Amended by section 7 ([[f7e0b9dd]], its §7.4.2 and §7.8):** F3 excludes the exact paths listed in section 7's table, each with its one subject and the reason its short stem is honest; the syntactic signal stays measured, and no general exemption for any stem exists.

v3: answers `spec-review-05-arch-astra.md` ("holds after fixes", R1–R9 and the A1–A3 table). Each point was checked against the code at `7c983ff46e`; all hold except the two rejected below.
- **A2, A3.** `Harness.standing` becomes `Harness.current`, which reconciles Opus's `active`: the run or session held now, with no lifecycle change. "Environment kinds" becomes **environment drivers** (`EnvironmentDriver(s)`), and `EnvironmentKind` stays the `host | sandbox` discriminator.
- **R1.** F1 exempts section 1's assembly surface `<module>/<module>.ts`. A rule measures a signal and never prescribes the fix: the fix is chosen by meaning, a rename or move when the file holds one subject and a split only along named subjects. F5–F7 are reading signals. F4's basis is restated as the operator's policy.
- **R2.** The two `ViewerId`s are two identities: `ScreenViewerId` (host) and `ViewLeaseId` (server). Principal keeps three roles, with `CommandOwner` → `CommandSubject`. S4 measures one concept, not one spelling.
- **R3.** `ActorRef` is the stored identity and `Actor` the resolved call. `TerminalActor` is replaced by `ActorRef` with the old commit-queue format still read. `Actor.foreign` becomes `Actor.session`, because it also covers native sessions without a project.
- **R4.** The host key stays its own brand, `HostRequestKey`, with its value set unchanged. The canonical call key holds an `ActorRef`.
- **R5.** `JudgedUnit` → `TraceGroup`. The external session row names the case before adoption. The call row keeps standalone tool calls.
- **R6.** `names` separates the syntactic facts it measures from the truth of a name. S7's import permission is gone. `names` has an incremental measurement model and a benchmark and envelope as N0's prerequisite. `literals` measures tag positions only.
- **R7.** Census totals corrected to 384,028 lines, S1 to 191, server brands to 16. The unretained figures are marked, and every census figure is a heuristic candidate, not a debt ledger.
- **R8.** Debt covers the app and packages through their own cards before N0. Each debt entry fingerprints the offender with lineage.
- **R9.** Refusal codes are frozen; a merge of two codes needs an answer version. The compatibility matrix gains the commit queue, the host key and the preference tables' covering compare-and-set (CAS).

**Rejected:**
- Astra's A1 remark that P3 may still be called "landing": the graph's commit keeps its owner and mechanism, but with a module named `landing`, one word with two meanings is the exact defect S7 cannot catch. Opus's I1 (v2.1) stands.
- R1's move of F3 to watch: a one-word plural stem names a collection, not the concept a file holds, and that is a naming defect by itself. F3 stays at gate, and its remedy may be a rename.

v3.1 answers the closing reviews, `spec-review-05v3-arch-opus.md` and `spec-review-05v3-arch-astra.md`; both hold after fixes, and every fix is taken.
- **Opus B1: two senses of "driver".** "Driver" already means what drives a maintenance act to completion (rule a00f91b0, section 2's intent drivers, section 3's recovery and tail drivers, `options.driver` at `enforcement/checks.ts:229`). It keeps only that sense and joins the glossary. The environment implementations become **environment backends** (`EnvironmentBackend`). **Backend** means the implementation behind one kind of a contract, which also covers `execution-host`'s launch backends (`nativeLaunch.ts`). Docker in `sandbox` is the **container engine**. A3 and the provider row are fixed.
- **Astra 1: `landed` → `recorded` is not an input rename.** It is a same-build rename of the native settle result's producer (`operations/nativeJournal.ts:45-63`, `operations/nativeTools.ts:234-245`) and reader (`projection/toolAnswer.ts:304-310`). The reader keeps reading `landed` in stored results, and no alias or tombstone is involved. If the result ever joins a shared answer of section 4, the change takes an answer version. Every other A5 bridge was checked the same way:
  - the stored act phase value is migrated, and any operation answer that carries it changes through an answer version;
  - old commit trailers stay in history, so readers accept both spellings and writers write `sync`;
  - `operationId` → `requestKey` is an input field, so `renamed` holds.
- **Astra 2: the old commit queue does not refuse new lines.** It skips an unreadable line with a warning (`enforcement/CommitQueue.ts:34-66`), which loses the commit. A downgrade across the format therefore has an installation preflight. Installation closes queue admission, and `enforcement` confirms a full drain: no waiting line and no unread line. The downgrade is refused otherwise, and the old reader never runs over the new format.
- **A1 is decided:** `landing`. Both reviewers support it, and naming is the designer's call.

v2.1: answers `spec-review-05-arch-opus.md`.
- **I1.** The graph's P3 commit is a **sync**. The act phase `landed` becomes `synced`, and the journal answer's `landed` becomes `recorded`.
- **I2.** Call scopes become **lifetimes**, and **context** is the model's.
- **Minor.** The mandate's host binding reads "where the thread may run".

v2: aligned with section 1 v10 (decision f658e190).
- The harness ruling is folded in, and the `foreign-*` renames are withdrawn.
- The tables section 1 asked for are named.
- The amendments section 1 already made are dropped, and the glossary's new ones are A1–A5.

# Tagma architecture spec · Section 5. Names — draft v3

**Question answered:** what things are called and who owns each name.
- The census was measured at HEAD `0ff63c1651`. v2 facts were read at `91643e0501`, and v3 facts at `7c983ff46e`.
- The census scripts and their output are `census.py`, `census.json` and `names-census.md` in the section writer's scratch (thread `01a0e0d4`).
- Nothing in the repository or the graph was changed, and no test or typecheck ran.

This section builds on sections 1–4, 8 and 9 (`f658e190`, `70083b67`, `511b13e3`, `d925fa0c`, `e04cfdcb`, `6bf40362`). Module names and owners are section 1 v10's. Where a name there gives one word two meanings, §5.12 amends it explicitly, for the operator's approval.

**Principle (the operator's word, binding here and on every later section).** Boundaries and names follow meaning: owners, logic, common sense ("a dog barks, a cat meows"). Where code imports from today is never an argument for what a thing is called or where it belongs. A name that cannot be made short and honest points at a missing owner, domain term or split (the `ag-term` contract), never at a longer name. The same principle binds the other way: a size or a count never proves a second subject, and a name rule never forces a fictitious owner.

## 5.1 Outcome

- **One glossary.** Every core word has one meaning and one owning module, and every other current meaning gets a named replacement. An agent entering any module reads the same word for the same thing (§5.4.1).
- **The harness concept is named without overlap.**
  - A **harness** is an agent runtime that runs threads. The concept and its contract belong to `threads`.
  - The **native harness** is Tagma's own (`native-harness`).
  - An **external harness** is one Tagma integrates: Claude Code, Codex, Grok, Devin, Cursor, Gemini, … (`external-harnesses`).
  - Today's other senses of `harness` get other words.
- **Module names tell a newcomer what the module owns.** All 27 of section 1's names pass that test except `delivery`, which gives "deliver" a second meaning beside handing something to a thread. It becomes `landing` (§5.4.2, A1).
- **One owner per identity, and one identity per name.**
  - Each branded id lives in its owner's `contract/wire`, or in `platform` when it is neutral.
  - True duplicates are merged. Identities that only share a spelling are named apart (§5.4.3).
- **Measurable file, directory and symbol rules.** They measure syntactic signals — a file named after its directory, a repeated directory word, a line budget, a sentence-long symbol, a `Tagma` prefix, a `*Owner` suffix, a retired word — and never prescribe the fix. The fix is chosen by meaning in the module's target map (§5.4.4–5.4.5).
- **Wire, store and catalog conventions** for operations, tables, columns, events, refusal codes and settings keys. The tables section 1 left to this section are named (§5.4.6).
- **Target names are fixed before the waves, never invented by a builder.** Each module's card in section 7 — server modules, packages and the app — lists its **target file map**. Builders rename by that plan (§5.4.7).
- **Held from day one.** A neutral `names` builtin enters gate once its benchmark and envelope stand. It carries today's violations as debt owned by the waves and refuses every new one (§5.4.9). It also carries "the graph core names no catalog tag".

## 5.2 Problem, with evidence

**What the census is.** It is a heuristic reading, not the debt ledger: `census.py` measures the same syntactic signals as §5.4.4–5.4.5 in a simpler way. The debt is what the `names` builtin records on its first run (§5.4.9), with each offender named.

**Population.** Production source only: tests and fixtures are excluded, and only `.generated.` and `.d.ts` files count as generated. That filter misses generated files such as `devin_pb.ts`, which appears among the F2/F5 candidates. The census covers 2,369 files and **384,028 lines**:
- `apps/tagma/server/src`: 870 files, 149,873 lines;
- `apps/tagma/app/src`: 480 files, 57,615 lines;
- `packages/*`: 1,019 files, 176,540 lines.

v2 printed 386,978, which is not the sum of the three. `index.*` files count among the files and in F6, and are excluded from lines and the other measures (`census.py:48-60`), so the denominators differ. The server figure is 870 at `0ff63c1651`, against section 1's 871 at `98d8d3a216`.

### 5.2.1 Signals by rule

| Rule (§5.4.4–5.4.5) | Server | App | Packages | Total | Worst files |
|---|---|---|---|---|---|
| F1 file named after its own directory | 9 | 13 (11 are generated `shared/ui/<c>/<c>.svelte`, exempt by the rule, not by the census) | 7 | 29 (18 not exempt) | `terminals/Terminals.ts` 2,650 lines; `graph/orientation/Orientation.ts` 1,220; `graph/projects/Projects.ts` 837; `http/handlers/handlers.ts` 350; `graph/journal/Journal.ts` 311; `harness/worlds/Worlds.ts` 203; `packages/llm/src/capture/relay/Relay.ts` 262 |
| F2 file stem repeats its directory's word | 89 | 125 | 70 | 284 | `terminals/TerminalStore.ts` 1,767; `harness/HarnessSessions.ts` 923; `harness/HarnessObservations.ts` 785; `worktrees/WorktreeFeed.ts` 690; `thread/ThreadRunStore.ts` 685; `app/lib/features/harness/HarnessHost.svelte.ts` 1,440; `app/lib/features/terminals/TerminalInput.ts` 1,186; `packages/agent/src/agent/AgentToolDoor.ts` 1,235 |
| F3 one-word plural stem over 200 lines (counted by command, not retained in `census.json`) | 16 | 1 | 1 | 18 | `terminals/Terminals.ts` 2,649; `graph/measure/Sources.ts` 1,257; `graph/core/Blocks.ts` 874; `graph/projects/Projects.ts` 836; `harness/sandbox/Sandboxes.ts` 826; `working/Worktrees.ts` 815; `graph/work/Tasks.ts` 771; `graph/core/Tags.ts` 549; `graph/core/Settings.ts` 548; `graph/work/Amendments.ts` 509; `graph/orientation/Touches.ts` 444 |
| F4 file over 600 lines (gate) / over 400 (signal) | 40 / 87 | 20 / 28 | 51 / 103 | 111 / 218 | server: `terminals/Terminals.ts` 2,650, `protocol/settings.ts` 1,921, `terminals/TerminalStore.ts` 1,767, `harness/WorkspaceChangeLog.ts` 1,737, `protocol/operations/graph.ts` 1,716, `harness/ThreadStore.ts` 1,556, `graph/measure/Doctor.ts` 1,461, `harness/TagmaStack.ts` 1,410, `harness/ThreadFiles.ts` 1,356, `graph/measure/Sources.ts` 1,258; packages: `execution-host/src/ExecutionRegistry.ts` 4,765, `agent/src/thread/conformance/runLog.ts` 4,525, `performance/src/StoreReports.ts` 2,039 |
| F5 file exporting ≥ 8 top-level names (classes, functions, capitalised constants; `export async function`, default exports and re-exports are not seen) | 45 | 11 | 81 | 137 | `protocol/terminals.ts` 48 in 569 lines; `protocol/worktrees.ts` 47; `install/closure.ts` 28; `packages/agent/src/thread/events.ts` 39; `packages/chat-ui/src/activity.ts` 33 |
| F6 directory holding > 25 source files flat | 10 | 5 | 6 | 21 | `harness/` 96 files at one level (184 recursively); `protocol/` 90 (133); `terminals/` 48 production files (100 with tests); `app/lib/features/harness/` 88; `app/lib/features/terminals/` 53; `packages/chat-ui/src/` 56 |
| F7 duplicate basename within one tree (whole app or package, `+page`/`+layout` included — wider than the rule's module) | 75 | 5 | 67 | 147 | server: `terminals.ts`, `sandbox.ts`, `files.ts`, `commandRules.ts` ×7 each; `worktrees.ts` ×6 |
| S1 exported symbol of ≥ 6 semantic words (gate) / ≥ 5 (signal) | 6 / 47 | 0 / 4 | 16 / 140 | 22 / 191 | `runTraceSignalReadSchema`, `ThreadOwnerSettingsRowProjectsForm`, `ThreadOutcomeStatusMatches`, `createElectronWindowBehaviorBrowserWindowOptions` (7) |
| S2 `Tagma` prefix | 148 | 0 | 1 | 149 | 78 in `harness/` (`Thread*` 58, `Tool*` 30), 62 in `protocol/` |
| S3 `*Owner` DI suffix (counted by command, not retained) | 25 | 0 | 0 | 25 | `terminals/` 7, `worktrees/` 5, `working/` 4, `harness/` 8 |
| S4 one type name declared in ≥ 2 files (a spelling count, not proof of one concept; counted by command, not retained) | 36 | — | — | 36 | `CallLog`, `ThreadStanding`, `Caller`, `TreeBlock`, `Standing`, `Lens`, `Answer`, `WorktreeListing` |
| S5 generic suffix, as the census counts it (`Manager`, `Helper`, `Utils`, `Processor`, `Handler`) | 37 | 1 | 1 | 39 | server: `*Handler` in `http/handlers/` (all 25 listed), which S5 allows in doors. The count after that exemption was not retained. App `FocusHelper`; packages `Handler` in `llm/src/capture/cursorStub/responses.ts` |

**Not reproducible from the saved record:**
- the §5.2.2 matrix, the median / p90 / p95 line figures v2 cited (83 / 380 / 575), and the F3, S3 and S4 counts were computed in the session by commands that were not retained;
- the counts of overloaded words in §5.2.3 are substring heuristics;
- a rerun at today's HEAD does not reproduce the snapshot at `0ff63c1651`.

N0's first run records the real figures.

### 5.2.2 Signals by today's server directory

Section 7 maps each directory to modules through section 1's territory (`spec-01v10-territory.json`, section 1 appendix A). Most of the worst directories dissolve into several modules. For example, `harness/` splits across `threads`, `native-harness`, `external-harnesses`, `change-record`, `landing` and `composition`, so each module's card carries its share.

| Directory | Files | Lines | >600 | F1 | F2 | F3 | F5 | S1 ≥5 | `Tagma*` | `*Owner` |
|---|---|---|---|---|---|---|---|---|---|---|
| `harness/` | 184 | 32,782 | 11 | 2 | 28 | 2 | 4 | 13 | 78 | 8 |
| `graph/` | 88 | 20,436 | 8 | 3 | 5 | 9 | 7 | 0 | 0 | 0 |
| `protocol/` | 133 | 18,346 | 3 | 0 | 1 | 0 | 27 | 22 | 62 | 0 |
| `terminals/` | 48 | 13,496 | 2 | 1 | 20 | 1 | 0 | 0 | 0 | 7 |
| `http/` | 63 | 9,177 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 |
| `working/` | 31 | 7,081 | 3 | 0 | 1 | 3 | 0 | 0 | 0 | 4 |
| `thread/` | 28 | 6,761 | 3 | 0 | 25 | 0 | 0 | 3 | 0 | 0 |
| `operations/` | 31 | 6,708 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `files/` | 31 | 5,707 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 1 |
| `cli/` | 36 | 5,554 | 3 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| `enforcement/` | 23 | 4,165 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |
| `worktrees/` | 10 | 2,533 | 1 | 0 | 7 | 0 | 0 | 0 | 0 | 5 |
| `db/` | 23 | 2,358 | 0 | 0 | 0 | 0 | 0 | 8 | 1 | 0 |
| others (`api`, `ai`, `projection`, `socket`, `install`, `skill`, `mcp`, `doctrine`, …) | 163 | 16,036 | 2 | 1 | 2 | 0 | 3 | 1 | 7 | 0 |

In the app, `lib/features/` holds 26 of its 28 files over 400 lines and 79 of its 125 F2 signals: the `terminals` feature (`Terminal*` in `terminals/`) and the `harness` feature (`Harness*` in `harness/`). In packages, three dominate:
- `agent`: 53 F2, 15 over 600, 42 symbols ≥ 5 words;
- `llm`: 6 F1, 8 over 600, 39 symbols ≥ 5 words;
- `execution-host`: 13 over 600.

### 5.2.3 Words with several meanings (F042)

The counts below are substring heuristics over exported identifiers in server, app and packages. They point at overloads; they do not prove each one.
- `harness` (about 205 identifiers) is used in four senses. Only the first two are the concept section 1 now owns:
  - an agent runtime: the kernel's engine (`AgentHarness`, `packages/agent/src/thread/AgentHarness.ts:342`);
  - an external CLI run as a thread: `HarnessSessions`, `HarnessObservations`, and `HarnessLane`, the serial typing lane into a CLI's terminal (`harness/HarnessLanes.ts:23`);
  - the app's thread UI (`HarnessHost.svelte.ts:150`), which is not the concept;
  - an error union (`TagmaHarnessFailed`, 286 uses), which is not the concept either.

  The `harness/` directory (184 files) holds all four, plus the thread store, authorship, landing and the composition root.
- `deliver` has three senses, in 113 production files of the server and `packages/agent` (`delivered` 200, `delivery` 165, `deliver` 91, `commandDelivery` 42, `deliveredToRunId` 40, `deliveredTags` 32, `harnessDeliveryClaim` 27):
  - handing a message, task, command notice, instructions or law to a thread (`WorktreeFinishing.ts:105` hands `update_worktree`'s task through `deliver`);
  - the graph's own commit by `sync_graph` (`graph-undelivered`, `WorktreeFinishing.ts:566-567`);
  - since section 1 v10, the `delivery` module's publishing of work into git.

  Git publishing is called `landing`/`landed` today (`landed` 318, `landing` 115). The graph's own P3 commit also "lands" (section 2 §2.4.8's act phase `landed`, and `landedByCall` at `operations/nativeJournal.ts:45`). §5.4.1 gives that sense the word **sync**.
- `standing` (78) has three senses: status snapshots (`AwakeStanding`, `HostStanding` 30, `RepositoryStanding`), eligibility (`StandingThread`, `StandingExecution`), and the graph's product word — a block neither resting nor replaced. Section 1 v10 adds two more: a thread's authority and rights, and `Harness.standing(thread)`.
- `provider` has two senses:
  - model providers: the `providers` module and the `thread_owner_settings.provider` column;
  - environment providers, the implementations that hold, admit, read, open and activate an environment (`workspaces/EnvironmentProviders.ts:32-63`, 24 uses). Beside them stand `EnvironmentKind = 'host' | 'sandbox'` and `EnvironmentBinding` (`protocol/environments.ts:8-21`), which are two further things.
- `foreign` has four senses:
  - the actor arm for any session-only caller (`protocol/caller.ts:21`). It covers an external CLI's session and also a native thread's grant with no project: `http/caller.ts:150-163` keeps the session `(tagma, threadId)` with no native identity, and `:383-398` returns the `foreign` arm;
  - a host held by another Tagma (`protocol/machineStanding.ts:102`, `http/handlers/health.ts:92`);
  - an observed root other than the bound one (`harness/HarnessObservations.ts:657-676`);
  - a mirror row of another project (`http/MirrorBuilder.ts:549-558`).
- `host` (134) has five senses: the execution host (`packages/execution-host`), the app's `HarnessHost`, the tool world `hostWorld` (`packages/agent-tools/src/World.ts:65`), `CaptureHost` (`packages/llm/src/capture/host/CaptureHost.ts:99`), and peripheral hosts.
- `floor` (21) has four senses, plus `FloorRefusal` (`protocol/refusal.ts:47`):
  - rollout append (`ThreadFloor`, `thread/ThreadFloor.ts:115`);
  - the graph write guard (`TreeFloorFaces`, `graph/core/Act.ts:80`);
  - the permission baseline (`MODE_FLOOR`, `packages/agent/src/permissions/index.ts:163`);
  - a numeric minimum (`performanceSpanFloorMicros`).
- `session` (90) has four senses: an external agent's conversation, an MCP connection, a speech session, and the `SessionRef` that also names native threads (`NATIVE_HARNESS`).
- `world` (58) has five senses: a tool world, the socket `PageWorld`, `CallerWorld = 'checkout' | 'elsewhere'`, `DoorWorld`, and `checkoutWorld`.
- `lane` (30) has five senses: external typing lanes, execution wire lanes (`control | walk`), judge lanes, transcript lanes, and terminal view lanes.
- `owner` (79) has four senses: 25 DI tags, the thread `ownerId`, the command `CommandOwner`, and the graph's code owners (`read_owners`).
- `origin` (27) has four senses: `WorkingOrigin`, `CredentialOrigin`, `NameOrigin` and `CommandOrigin`. Section 3 adds the callback origin.
- `scope` has four senses: a graph subtree lens (`?scope`), section 4's call scopes, a file permission scope (`FileScope`), and Effect's `Scope`.
- `unit` has three senses:
  - a store transaction (`db/Units.ts`);
  - a setting's measure unit;
  - the performance `JudgedUnit`, the annotation that makes a span head a group: its descendants inherit the group id, and the head's end decides whether the group is kept (`packages/performance/src/PerformanceTracer.ts:202-207,295-321`).
- `act` has several senses: a graph write (`graph/core/Act.ts`), `CheckoutActs`, `ThreadActs`, `WorktreeActs`, and the host's `TerminalAct`.
- `operation` has three senses: a catalog entry, the durable intent rows `terminal_operation` and `worktree_operation`, and the executions wire's `OperationId`.
- **The thread itself has two models.**
  - `thread.name` (`db/thread.ts:60`, nullable) vs `native_thread.title` (`:209`, default `'New thread'`).
  - Two `createdAt` (`:79`, `:227`).
  - Four liveness signals: `thread.status`, `thread_run.status`, `thread_live_spell`, and the CLI facet. Sections 1 and 2 split these into the record, the mandate, the native row and `external_session`.
- 148 `Tagma*` identifiers mark the seam between the kernel's thread and the product's `native_thread`. They are not 148 proven defects (Astra §5).

### 5.2.4 Identity duplicates and look-alikes (F043)

- **`ViewerId` names two identities, not one duplicated.**
  - The host's `Presentation.openViewer` makes its own UUID and holds a screen base, credit and staleness (`packages/execution-host/src/Presentation.ts:113,210-233`).
  - The server's `LiveViewers.open` makes a different `viewer:<uuid>` lease that holds a connection, an execution, a source and acknowledgements (`protocol/terminals.ts:324`, `terminals/LiveViewers.ts:22-30,46-64,91-120`).
  - The socket opens the lease and the host screen stream separately (`socket/terminalChannel.ts:53-68`). The lease boundary is claim [[549f1d4b]].
- `ThreadTargetOperationKey` (`protocol/threadTarget.ts:8`) and `WorktreeOperationId` (`protocol/worktrees.ts:9`) are character-identical schemas under two brands. Both are keys a caller names for a durable server intent.
- **The host wire's `OperationId`** (`packages/executions/src/protocol/execution.ts:20-26`) is a non-empty string. Its production keys contain colons: `<key>:stop`, `<execution>:limit:<uuid>` and `<execution>:background:<revision>` (`harness/worlds/commandWork.ts:126,359,384`). It shares only a spelling with the server's catalog `OperationId` (`protocol/operations/index.ts:55`).
- **Three roles share the word "owner" or "principal".**
  - The credential principal is the identity credentials are held for: `ownerId` (`CREDENTIAL_OWNER = 'operator'`, `ai/Models.ts:20`) and `Actor.thread.ownerId` (`protocol/caller.ts:15`).
  - The custody principal is the opaque `Principal` a host holds executions for (`packages/executions/src/protocol/custody.ts:5`), for example `thread:<id>` (`protocol/terminals.ts:39-49`).
  - The command policy subject is `CommandOwner`, with the arms `Thread`, `Operator` and `Service{scope}`.
  - `principalOfOwner` folds `Service` and `Operator` into the custody principal `operator`, while `ownerKeyOf` keeps `service:<scope>` (`protocol/commandPolicy.ts:32-63`). The projection loses the service case, so the subject is not a principal. Claim [[95f23a71]] leaves the principal's value to the product.
- **`Actor` and `TerminalActor` are not one type twice.**
  - `Actor` is the resolved call: `thread` carries `session`, `reach`, `ownerId` and an optional `act` (`protocol/caller.ts:9-24`).
  - `TerminalActor` (`protocol/terminals.ts:27`, built by `terminalActorOf`, `protocol/terminalActor.ts:6-15`) is a narrow projection, and it is **stored**: `QueuedCommit.caller` is appended to the commit queue's file with fsync and decoded at load (`enforcement/CommitQueue.ts:6-18`).
  - `terminalActorOf` refuses a native session with no project (`:9-13`).
- 30 branded id schemas exist. The server's `protocol/` declares **16** of them (v2 said 11; `names-census.md` lists 16).

### 5.2.5 Contract names

- **Operations:** 157 ids. They are verb-first `snake_case` except:
  - `graph_overview` (noun first);
  - `ready_tasks` (adjective);
  - the eight `checkout_*` operations (noun first).
- **Refusal codes:** 226 distinct, all kebab-case or a single word. Five spellings mean "absent or wrong": `not-found`, `no-*` (14), `*-missing` (9), `unknown-*` (7) and `not-a-*` (9).
- **Settings:** 90 keys, all `namespace.camelCase` in 16 namespaces. `agent` (16 keys) and `agents` (1) are near-duplicates.
- **Tables:** 72, all singular `snake_case`. `native_thread*` (3) carries a product prefix, and `thread_owner_*` (3) carries the retired sense of `owner`.
- **Socket:** 33 RPC names, all `area.verb`. Feed tags are lowercase except the command feed's `Snapshot | Delta` (`protocol/commandFeed.ts:54,59`).
- **No glossary exists** in code or in the graph (searching for glossary, vocabulary and term finds nothing).

## 5.3 What holds now, checked against the code

- Tables and columns are consistent: singular `snake_case` tables, `snake_case` column strings, and camelCase TS keys (0 exceptions, `db/*.ts`).
- Settings keys follow `namespace.camelCase` without exception.
- Socket RPC names follow `area.verb` or `area.noun.verb` without exception.
- Refusal codes are kebab-case, 219 of 226; the other 7 are single words.
- Operation ids are `snake_case` and verb-first for 147 of 157.
- The graph's product words are used consistently in delivered text and tool descriptions: block, claim, task, rule, scope (subtree), owner (of a code path), standing (not resting), debt, finding.
- **The harness concept already has code:**
  - birth dispatches on it (`harness/ThreadActs.ts:238`);
  - external CLIs share one adapter shape (`protocol/harness/adapter.ts#HarnessAdapter`) and one table of six (`protocol/harness/table.ts:10`);
  - the native harness is the id `tagma` (`protocol/session.ts:5`);
  - external agents are the `harness:*` ids.
- **`Actor` is in-memory; its projection is persisted.** `Actor` is built in `http/caller.ts:383-398` and read in `operations/commands.ts:50` and `operations/commandRules.ts:41`. Its terminal projection, with the tags `Operator`, `Thread` and `Foreign`, lives in the commit queue's file (§5.2.4).
- The `ag-term` contract exists as a skill but is enforced nowhere. Rule 8183e6ef (no re-exports) is the only name-adjacent law at gate.

## 5.4 Target model

### 5.4.1 The glossary

**Scope.**
- The glossary binds `apps/tagma/*` and the packages that carry Tagma's product concepts: `agent`, `agent-tools`, `executions`, `execution-host`, `performance`, `files`, `git`, and `layer` where it is exported into Tagma's contract.
- Other packages (speech, TTS, window behaviour, capture) keep their own domain vocabulary. An identifier of theirs that enters a Tagma `contract/wire` takes the Tagma word at that boundary.
- Library terms (Effect's `Scope`, `Layer`, `Context`; MCP's `session`; Svelte and shadcn conventions) are exempt inside the code that uses the library.
- One meaning per word: a word in the table appears in an exported identifier only with its meaning, and another sense uses the replacement. Owners are section 1 v10's (§1.2).

**Harnesses and threads.**

| Word | The one meaning | Owner | Other current meanings → replacement |
|---|---|---|---|
| **harness** | an agent runtime that runs threads. Its two kinds are the native harness and external harnesses. The concept, the `Harness` contract and its registry are one thing | `threads` (concept, port, registry); `HarnessId` in `platform` (neutral: it names a harness and lists none) | the `harness/` directory → dissolved into its owners by section 1's territory, so no directory keeps the name; the app's `lib/features/harness/` and `HarnessHost` → `lib/features/threads/` and a threads view with native and external sub-views (section 1 §1.7); `TagmaHarnessFailed` → each owner's failure type. **Kept in its sense:** `AgentHarness` (the kernel's engine, an agent runtime a harness composes); the `harness:*` agent ids (one external agent per installed CLI); `harness_delivery_claim` (a delivery into a harness) |
| **native harness** | Tagma's own harness: it runs a thread on the kernel with Tagma's instructions, tools, models, transcript, compaction and workflows. Its `HarnessId` is `tagma` | `native-harness` | — (`NATIVE_HARNESS` stays) |
| **external harness** | an agent runtime whose loop, model, context and transcript live outside Tagma (Claude Code, Codex, Grok, Devin, Cursor, Gemini, …). Tagma launches or adopts it, observes its evidence and types into it, and never controls it. Each CLI is a **vendor** with one adapter | `external-harnesses`; path `external-harnesses/vendors/<cli>/` | v7's `clients` and `cli-sessions` modules → this module |
| **external** | belonging to an external harness | `external-harnesses` | — |
| **foreign** | retired | — | the session-only actor arm → **session** (`Actor.session`: it covers external sessions and native sessions with no project, and the harness stays in its `SessionRef`); `KeepWarm`'s `foreign` (a thread with a harness) → **external**; a host held by another Tagma (`custody: 'foreign'`), a root other than the bound one, a mirror row of another project → **other** |
| **kernel** | `packages/agent`: the agent runtime kit every agent of the monorepo runs on — its loop, run machine, tools, permissions and collaboration kit | `packages/agent` | — |
| **thread** | a long-lived conversation with identity, run by a harness | record: `thread-record`; life: `threads` | — |
| **mandate** | what Tagma entrusts to and allows a thread, whatever runs it: authority (approval mode, rules, bypass), collaboration rights, delegation, the spawn budget, and where the thread may run (the host binding) | `threads` (`thread_mandate`) | section 1's "thread — standing" → **mandate** (A2) |
| **current** | the run or session a harness holds for a thread now, or none (`Harness.current`). It says what is held, not whether a model is working | `threads` (the face); each harness (its answer) | `Harness.standing(thread)` → `Harness.current(thread)` (A2) |
| **journal** | every thread's ordered record of what happened in it | `threads` | — |
| **rollout** | a thread's journal at rest in its file, with its lane | `threads` | — |
| **transcript** | a native thread's model history: the folds projected from its journal | `native-harness` | — |
| **context** | what a native model sees: its window, the context reading, the context epoch, and what compaction fits into the window | `native-harness` | the call's levels → **lifetimes**; Effect's `Context` is exempt |
| **run** | one accepted attempt of a native thread's turn | `native-harness` | a setup run → **setup**; a capture run → **probe** |
| **step** | one model request and the tool calls it issued, inside a run | `native-harness` | — |
| **session** | a harness's own identity for one conversation: `SessionRef = (harness, key)`. A native thread's is `(tagma, threadId)`. Each store's writer register interns them (the `session` table) | `platform` | an external harness's live session → **external session**; MCP and speech sessions are library terms, exempt |
| **external session** | an external CLI run as a thread, launched or adopted, observed and typed into; Tagma's record of it is its `external_session` row. **Before adoption** a CLI has only a session token naming a session and a project — no thread and no row — and it calls as an `Actor.session` | `external-harnesses` | — |
| **facet** | retired | — | the harness JSON on the thread → the `external_session` row |
| **agent** | what a thread is born as: a library entry naming the harness that runs it | `threads` (library); `native-harness` (native definitions); `external-harnesses` (one per CLI) | — |
| **deliver** | to hand something to a thread: a message, a task, a command notice, instructions or law | `threads` (messages and work); `native-harness` (instructions); `graph` (law and tags in a touch) | publishing work into git → **land** (A1); the graph's own commit → **sync** (`sync_graph`; the code `graph-undelivered` stays frozen as data) |
| **name** / **title** | `name`: the address a team uses for a thread, unique among its siblings; `title`: what a reader sees | `thread-record` | — |
| **placement** | putting a thread at a target, at birth or by a move | `threads` | — |
| **target** | where a thread's work or an execution runs: checkout, worktree or guest | `threads` (thread targets); `executions` (execution placement) | — |

**Work, trees and git.**

| Word | The one meaning | Owner | Other current meanings → replacement |
|---|---|---|---|
| **project** | a codebase the operator registered: id, name, canonical address | `projects` | — |
| **root** | a directory Tagma serves or works in, proved by a filesystem witness | `workspace` | installation root → **data directory**; UI and test roots are local, exempt |
| **checkout** | a git working tree on disk; the **canonical checkout** is the project's own | `workspace` | — |
| **worktree** | a Tagma-managed checkout with a branch, a base and a lifecycle | `worktrees` | — |
| **change** | a session's change: its held lines and the tree they would make | `change-record` | — |
| **landing** | the activity of putting work into a project's git on a thread's or the operator's behalf: landing a session's change (`submit_work`), the preservation landing of a retiring worktree's leftover work, merging a worktree into its base, pull requests, the merge queue, and the receipts of each. **To land** is to make one such commit; a landing commit follows the landing protocol | `landing` (A1) | the module name `delivery` → `landing` (A1); the graph's P3 commit of its own acts → **sync** (A5); the native journal's `landedByCall` and its answer field `landed` (`operations/nativeJournal.ts:45-63`, `TagmaToolLanded` at `protocol/toolResult.ts:170`) → **recorded**: the act is recorded in the journal |
| **sync** | the graph's commit of its own acts into the project's git: P3 of section 2 §2.4.8, requested through `sync_graph`. An act that has reached git is `synced` | `graph` | the act phase `landed` → `synced`; "landing commit" in §2.4.8 → **sync commit** (A5) |
| **merge** | integrating a worktree's branch into its base | `landing` | — |
| **environment** | where executions may run (the machine, a container), acquired as a scoped world with a witness | `workspace` (the contract, identity and binding) | — |
| **environment kind** | the discriminator of an environment: `host` or `sandbox` (`EnvironmentKind`, `protocol/environments.ts:8`) | `workspace` | — |
| **environment backend** | the backend of one environment kind. It holds a resource, admits it inside a unit, reads its state, opens a scope and activates the environment, tells a refused open (`OpenRefused`) from a lost one (`OpenLost`), and releases the scope | `workspace` (the `EnvironmentBackend` contract); `executions` (the host backend); `sandbox` (the guest backend) | `EnvironmentProvider(s)` → `EnvironmentBackend(s)` (A3) |
| **backend** | the implementation behind one kind of a contract: an environment backend (host, guest), a launch backend of the execution host (pty, pipe; `packages/execution-host/src/nativeLaunch.ts`) | the contract's declarer | Docker behind the guest backend → **container engine** |
| **container engine** | the program that runs the guest backend's containers (Docker today) | `sandbox` | — |
| **driver** | what drives a maintenance act to completion in the running server: at boot, on a cadence, or on an event (rule a00f91b0; section 2's intent drivers; section 3's recovery and tail drivers; `options.driver`, `enforcement/checks.ts:229`) | the owner of the act | — |
| **sandbox** | a disposable guest environment with prepared trees | `sandbox` | — |
| **graph** | the project's knowledge graph | `graph` | — |
| **act** | one graph write made by one call (`graph_act`) | `graph` | `CheckoutActs` → **checkout writes**; `ThreadActs`, `WorktreeActs` → named for what they do, per their card (section 7); the host's `TerminalAct` → **host request** |
| **scope** | a graph subtree a read or a rule is narrowed to | `graph` | section 4's call "scopes" → **lifetimes** (A4); `FileScope` → **file reach**; Effect's `Scope` exempt |
| **standing** | in the graph, a block that is neither resting nor replaced | `graph` | the thread's authority and rights → **mandate**; `Harness.standing` → **current** (A2); status snapshots (`HostStanding`, `AwakeStanding`, `RepositoryStanding`) → **state**; eligibility (`StandingThread`, `StandingExecution`) → **live**; the two `ThreadStanding` types → per their cards |
| **owner** | the graph block that owns a code path (`read_owners`), and in prose the module that owns a thing | `graph` | DI `*Owner` classes → the service's own name; the credential sense (`ownerId`, `thread_owner_*`) → **principal**; `CommandOwner` → **`CommandSubject`**; `HostIdentity.ownerId` → named for its role by the `executions` card |

**Executions, calls and mechanics.**

| Word | The one meaning | Owner | Other current meanings → replacement |
|---|---|---|---|
| **execution** | a process Tagma holds on the execution host, addressed by execution id and incarnation. Its kinds are **terminal** and **command** | `executions` | `RunTraceHostAct` stays (a trace of a host act) |
| **terminal** | an interactive execution with a screen | `executions` | — |
| **command** | a non-interactive execution a caller starts; command rules bound commands | `executions` | a CLI command → **verb** (section 1 §1.6.3) |
| **viewer** | a reader of a terminal. The host's **screen viewer** holds a screen base, credit and staleness (`ScreenViewerId`). The server's **view lease** binds a connection to an execution and its source, with acknowledgements (`ViewLeaseId`) | `packages/execution-host` (screen viewer); `executions` (view lease) | the two `ViewerId`s → `ScreenViewerId` and `ViewLeaseId` |
| **host** | the execution host process (`packages/execution-host`) | `packages/execution-host` | app `HarnessHost` → a threads view; `hostWorld` → `machineWorld`; `CaptureHost` → `CaptureRig`; `HostStanding` → `HostState` |
| **world** | what a thread's tools act through: its files, shell and execution environment | `executions` (worlds); the kernel's `World` type in `agent-tools` | `CallerWorld` → `CallerPlace`; `PageWorld`/`DoorWorld` (test rigs) → `PageRig`/`DoorRig` |
| **call** | one invocation of one operation through one door. A native tool call of an operation is a call; a **standalone tool** call (files, shell, web — section 1 §1.2's capabilities) is a tool call, not an operation call | `invocation` (calls); `native-harness` (standalone tools) | — |
| **operation** | a declared entry of the catalog (section 4) | `platform` (declaration machinery); each module (its own) | durable effect rows `terminal_operation`, `worktree_operation`, `thread_target_operation` → **intent** (`terminal_intent` already exists); the key a caller names → **request key**; the executions wire's `OperationId` → **host request key** (`HostRequestKey`) |
| **door** | the transport a call enters by: native tool, HTTP, socket, CLI, MCP | `invocation` and the doors | `@runlith/layer`'s app lookup doors → **lookup** (package owner) |
| **lifetime** | one level of the services a call runs with: installation, workspace, run, call (section 4). Each lifetime's services belong to that lifetime's owners | `invocation` (assembly); the owners named by section 1 rule 7 | section 4's "scopes" → **lifetimes**, `ScopeServices` → `LifetimeServices`; "the call context" in prose → **the call's services** (A4) |
| **origin** | never alone in an identifier. The **working origin** is where a caller works: its proved root, generation and the work it is for. The **callback origin** is the external call a callback descends from | `workspace` (working origin); `invocation` (callback origin) | `CredentialOrigin` → **credential source**; `NameOrigin` → **title source**; `CommandOrigin` → **command source** |
| **actor** | the resolved caller of one call, with what it is allowed now: operator, thread, or session (a session-only caller: an external session, an unadopted CLI's token, or a native session with no project) | `platform` (type); `invocation` (resolution) | — |
| **actor ref** | the stable identity of a caller, fit for storing and attributing: `operator`, `thread(threadId, projectId)` or `session(SessionRef, projectId)`. It carries no reach, act or grant, and it never restores authority | `platform` | `TerminalActor` → `ActorRef` (the old commit-queue format is still read, §5.4.8) |
| **principal** | an opaque identity something is held for. Its roles are named apart: the **credential principal** (whom credentials are held for), and the **custody principal** (`packages/executions`' `Principal`, whom the host holds executions for) | `platform` (the term); `providers` (credential principal); `packages/executions` (custody brand) | thread `ownerId` → `principalId` where it holds the credential role |
| **command subject** | whom a command's policy is judged for: a thread, the operator, or a service scope (`CommandSubject`, today `CommandOwner`) | `executions` | `CommandOwner` → `CommandSubject`; its projection to a custody principal stays a projection |
| **provider** | a model provider and the access Tagma has to it | `providers` | environment providers → **environment backends** (A3); Effect's `provide` is exempt |
| **account** | one credentialed access to a provider | `providers` | — |
| **lane** | a serialized queue whose entries are served in order (section 3's hook, commit and inspection lanes; an external session's typing lane) | the owner of each lane | execution wire `control | walk` → **channel**; terminal view lanes → **view** |
| **floor** | retired | — | rollout append (`ThreadFloor`) → **rollout writer**; graph write guard (`TreeFloor`) → **tree guard**; `MODE_FLOOR` → **mode baseline**; numeric floors → `min`; `FloorRefusal` → `ServingRefusal`; section 1's import floors are **layers** inside a module |
| **unit** | one transaction on one store (section 2) | `platform` | setting units → **measure**; the performance `JudgedUnit` → `TraceGroup`, and its marker → `TraceGroupHead`: a group whose head decides whether it is kept |
| **stack** | retired | — | `TagmaStack` → the `composition` root and the module manifests |

- **The glossary's home** is the `names` rule's parameters (§5.4.9): each word's meaning, owner and regions, and retired senses with their replacements. It is readable through `read_inspections` and delivered with the rule. Each module's `#module` body uses the words, and these tables are the first version of those parameters.

### 5.4.2 Module names

Test: **does the name tell a newcomer what the module owns, and does its word keep one meaning across the glossary?** Each of section 1 v10's 27 names was measured against its §1.3 row.

| Module | Holds (section 1 §1.3) | Verdict |
|---|---|---|
| `platform` | mechanics with no subject; neutral vocabulary | keep |
| `projects` | which projects are registered, under what name and address | keep |
| `settings` | every declared setting's value, resolution and history | keep |
| `providers` | access to model providers: accounts, credentials, quotas, models | keep. "provider" keeps one meaning; environment implementations are backends (A3) |
| `thread-record` | every thread's identity and published facts | keep |
| `workspace` | where work stands and what is in its trees: roots, repositories, coverage, environments, assignments, checkout readings, writes and history, the watch | keep. Section 1 gives it one meaning, and the served checkout is one of its trees |
| `graph` | the project's knowledge and its serving | keep |
| `catalogs` | the shipped vocabularies | keep |
| `installation` | this installation: data directory, builds, succession, registry, setup, restore | keep |
| `change-record` | who wrote which line, which lines a session holds, and the change they make | keep |
| `power` | keeping the machine awake and the agents' pace | keep |
| `mcp`, `artifacts`, `performance`, `sandbox` | what their names say | keep |
| `executions` | commands and terminals on the execution host | keep (renamed from `terminals` by section 1) |
| `enforcement` | judging code against the project's rules, `check_rules` included | keep |
| `worktrees` | Tagma-managed worktrees and their lifecycle | keep; section 1 narrowed it to what the name says |
| `delivery` | putting work into a project's git on a thread's or the operator's behalf: landing a session's change, the preservation commit, merges, pull requests, the merge queue and their receipts | **rename `landing` (A1).** "Deliver" already means handing a message, task, instructions or law to a thread, in 113 production files and about 600 identifiers (§5.2.3). Section 1 itself uses that sense in `Harness.deliver`, "instructions delivery" and "delivered tags and law". A newcomer who opens `delivery/` expects the inbox. The product already calls this activity landing (`landed` 318, `landing` 115): `submit_work` answers `landed` (`protocol/submitReceipt.ts:26`), and section 3's intent is `landing` |
| `threads` | the life of every thread, whatever runs it, and the `Harness` contract | keep |
| `native-harness` | Tagma's own agent runtime | keep. It is singular because there is one |
| `external-harnesses` | external agent CLIs run as threads, one adapter per CLI | keep. It is plural because there are many |
| `invocation` | running one call | keep |
| `http`, `socket`, `cli` | the doors | keep |
| `composition` | assembling the modules | keep |

**Module and directory form.**
- A module's directory is its name in kebab-case.
  - The name is a plural noun where the module owns a collection of like things (`threads`, `executions`, `providers`, `external-harnesses`).
  - It is a singular, mass or activity noun where the module owns one thing or a capability (`native-harness`, `landing`, `enforcement`, `invocation`).
  - Section 1 §1.7's assembly surface `<module>/<module>.ts` is part of the module form. It is named after its directory by design and is exempt from F1.
- Inside a module, a directory groups **one concept** (`executions/terminals/`, `executions/commands/`, `external-harnesses/vendors/<cli>/`), never a technical layer. The exceptions are section 1's `contract/wire` and `contract/service`.
- **Inside a harness module, the module word is not repeated.** `harness/HarnessSessions.ts` becomes `external-harnesses/sessions.ts`, and `HarnessLane` becomes `SessionLane`. A boundary symbol read outside the module keeps its domain word (`ExternalSession`, `NativeRun`), by §5.4.5's boundary rule.

### 5.4.3 Identity types

- **Placement.** Each id type is one branded schema in its owner's `contract/wire`, or in `platform` when it is neutral: meaningful to every module and owned by none.
- **Merge only one identity.** Two types are merged only when they name the same thing: the same resource, the same producer and the same lifetime. A shared spelling or a character-identical schema is not evidence of that.

| Id | Owner | Notes |
|---|---|---|
| `OperationId` (the catalog's brand), `CallKey`, `RequestKey`, `ActorRef`, `Actor`, `SessionRef`, `HarnessId`, `Credential` | `platform` | `RequestKey` is the key a caller names for a durable server intent. It merges `ThreadTargetOperationKey` and `WorktreeOperationId`, which name the same thing with today's shared format (`[A-Za-z0-9._-]`, ≤ 200, not `.`/`..`). `HarnessId` is a brand without a list; the list of external harnesses is `external-harnesses`' |
| `HostRequestKey`, `OperationRef` (unchanged), `ExecutionId`, `Incarnation`, `Principal` (custody) | `packages/executions` (the host wire) | `HostRequestKey` is today's host `OperationId` renamed, with its value set unchanged: a non-empty string, colons included (§5.2.4). The package declares it and imports nothing from the server or `platform` |
| `ScreenViewerId` | `packages/execution-host` | today's `ViewerId` at `Presentation.ts:113` |
| `ViewLeaseId` | `executions` | today's `ViewerId` at `protocol/terminals.ts:324`; the lease of claim [[549f1d4b]] |
| `ProjectId` | `projects` | |
| `BlockId`, `TreeId`, `ActId` | `graph` | |
| `ThreadId` | `thread-record` | today in `protocol/assignments.ts`; it moves |
| `RunId`, `StepId` | `native-harness` | |
| `RootId`, `UseId`, `EnvironmentId`, `EnvironmentUseId`, `RepositoryId`, `WorkspaceGeneration` | `workspace` | `ContextGeneration` → `WorkspaceGeneration`: it numbers the workspace lifetime, and "context" is the model's |
| `WorktreeRevision` | `worktrees` | |

- **Actor and ActorRef.**
  - `Actor` (`platform`) is the resolved call, with the arms `operator`, `thread` and `session`. `Actor.thread.ownerId` becomes `principalId` in its credential role.
  - `ActorRef` (`platform`) is what is stored and attributed. `TerminalActor` is replaced by `ActorRef`, and the commit queue decodes its old `Operator | Thread | Foreign` lines into `ActorRef` (§5.4.8).
  - A native session with no project keeps its refusal at terminal admission (`protocol/terminalActor.ts:9-13`).
  - An unadopted external client keeps section 4 §4.4.3a's policy: it is not the operator, it has no run scope, and its own client's approval is not Tagma's verdict.
- **Wire spelling.**
  - A field holding an id is `<thing>Id` in camelCase JSON, typed by its brand. The DB column is `<thing>_id`.
  - A key the caller names is `requestKey` (§5.4.8).
  - An incarnation-scoped id travels with its incarnation, never alone.
  - Numbers are ids only where the store's integer key is the identity (`projectId`).

### 5.4.4 File and directory rules (measured by `names`)

Each rule measures a syntactic signal. None of them proves that a file holds several subjects, and none prescribes the fix.

| Rule | Measure | Strictness |
|---|---|---|
| **F1** No file is named after its own directory | the stem, normalised, equals the directory's name or its singular (`terminals/Terminals.ts`, `graph/projects/Projects.ts`). Exempt: section 1's assembly surface `<module>/<module>.ts`, generated shadcn `ui/<c>/<c>.svelte`, and the `index.ts` barrels rule 8183e6ef allows | gate |
| **F2** A file does not repeat its directory's word | the stem's first semantic word equals the directory's name or its singular (`terminals/TerminalStore.ts` → `executions/terminals/store.ts`, exporting `TerminalStore`). A module directory counts with its words: `harness` in `native-harness/` and `external-harnesses/` | gate |
| **F3** No collection-named file | a one-word plural stem naming a domain collection (`Worktrees`, `Settings`, `Projects`, `Tasks`) over 200 lines: the name says "everything about X" instead of the concept the file holds | gate |
| **F4** Line budget | over **600** lines is gate: a file in debt stands at whatever size it is measured, and a new file stays at or under 600. Over **400** is a signal (watch) | gate / watch |
| **F5** Many top-level exports | exporting ≥ 8 top-level names (a schema and its type count once) | watch: a reason to read, not a defect |
| **F6** Wide directory | more than 25 source files at one level | watch |
| **F7** Repeated basename | two files with the same stem in one module outside directories that name distinct concepts (`executions/terminals/store.ts` beside `executions/commands/store.ts` is honest) | watch |

- **The fix is chosen by meaning, in the module's map.**
  - F1–F3: when the file holds one subject, the fix is a rename or a move, which removes the repeated context. A split is made only where the file holds several named, independent subjects, and it keeps a shared lifecycle or transaction together.
  - F4 over budget: the fix is a split along subjects when the file holds several. When it genuinely holds one subject, the budget is loosened for that file through `enforce_rule`, visibly, with the reason. Lines are never distributed across files to meet the number.
- **Why 600 and 400.** The budget is the operator's policy: the section's brief asks for measurable rules at gate, and long files are the core of the complaint. It is not a derived read cost.
  - The catalog requires whole reads when a zone is documented, not before every edit, so it is no basis for the number.
  - The numbers are set against today's distribution. v2 cited median 83, p90 380 and p95 575, computed in the session and not retained (§5.2.1). The first run of `names` records the real distribution.
  - The gate holds the line at 600 so that no file grows past what the map will fix.
- **Casing** follows the layer's existing convention: camelCase `.ts` stems and PascalCase Svelte components. Casing is never a reason to rename on its own.

### 5.4.5 Symbol rules (measured by `names`)

| Rule | Measure | Strictness |
|---|---|---|
| **S1** No sentence names | an exported symbol of ≥ 6 semantic words (gate) or 5 (watch), counted as `ag-term` counts. Protocol names, provider payloads, migrations, tests and generated code are exempt | gate / watch |
| **S2** No `Tagma` prefix | an exported identifier starting `Tagma` + capital; inside Tagma the product is implied. Allowed only where a same-named kernel type is imported into the same file, until the two models merge. `TAGMA_*` environment variables and `Tagma-*` headers are the product's external names | gate |
| **S3** No `*Owner` DI suffix | a service class named `*Owner`: the key takes the service's own name | gate |
| **S4** One declaration per concept | the same exported type name declared twice **within one module** (gate). The same name in two modules is a signal (watch): independent types may share a short name, and a reviewer decides whether they are one concept | gate / watch |
| **S5** No generic owners | `Manager`, `Helper(s)`, `Util(s)`, `Processor`, `Stuff`, `Misc`, `Common`, `Data` or `Info` as the head word. `Handler` is allowed in doors, where it is the transport's term | gate |
| **S6** No repeated owner context | a method or property that repeats its class's or file's head noun (`TerminalStore.readTerminal`) | watch |
| **S7** Glossary words carry their meaning | (a) a **retired spelling** — `Floor`, `Stack`, `Foreign`, `Facet` and each retired sense's pattern — in an exported identifier inside the glossary's regions, outside declared exceptions: gate. (b) A **reserved word** used outside its owner's regions: watch. `Harness` is reserved to `threads`, `native-harness`, `external-harnesses`, `packages/agent` and the app's `lib/features/threads/`. An import of the owner's contract is not evidence of meaning, and it grants nothing | gate / watch |

- An exported **boundary symbol** keeps its domain word (`TerminalStore`), because the import site would otherwise read a vague `Store`. Private and local names drop it.

### 5.4.6 Contract and store names

- **Operations** are `verb_noun` in `snake_case`, from the owner's vocabulary.
  - Reads use `read_` (one thing or its detail), `list_` (a collection), `search_` or `query_`.
  - Waits use `wait_`, and pure verdicts use `check_`.
  - Every other verb writes.
  - These break the grammar and are renamed in their module's wave with section 4's aliases:
    - `graph_overview` → `read_overview` (graph);
    - `ready_tasks` → `list_ready_tasks` (graph);
    - `checkout_stage|unstage|discard|commit|push|fetch|pull|abort` → `stage_checkout`, `unstage_checkout`, `discard_checkout`, `commit_checkout`, `push_checkout`, `fetch_checkout`, `pull_checkout`, `abort_checkout` (workspace).
  - An old and a new id resolve to one canonical identity before lookup and digest, so existing receipts stay valid. A new id is checked against this grammar by the catalog's contract snapshot (section 4 K5b), which is runlith's own convention, not part of the neutral builtin.
- **Tables** are singular `snake_case`, named for the record, with no module or product prefix. **Columns** are `snake_case`, with ids as `<thing>_id` and times as `<event>_at`. The tables section 1 left to this section are named here, with their owners (section 2 §2.4.4 as amended by section 1 §1.13):

  | Record | Table | Owner |
  |---|---|---|
  | a thread's authority, rights, delegation, spawn budget and where it may run | `thread_mandate` | `threads` |
  | Tagma's record of an external thread (the whole former facet, `held` included, and legacy-run facts) | `external_session` | `external-harnesses` |
  | one worktree archive call, its phases and its preservation receipt key | `worktree_archive_intent` | `worktrees` |
  | a settled merge, the durable source of the merged note | `merge_receipt` | `landing` |
  | a credential principal's approval mode (from `thread_owner_settings`) | `approval_preference` | `threads` |
  | a credential principal's provider, model, reasoning, default switches and favourite models (from `thread_owner_settings`) | `model_preference` | `native-harness` |
  | a credential principal's default account per provider (from `thread_owner_settings.default_accounts`) | `default_account` | `providers` |
  | a principal's standing permission rules and their withdrawals (`thread_owner_rule`, `thread_owner_rule_withdrawn`) | `permission_rule`, `permission_rule_withdrawal` | `threads` |
  | a thread's live spell and seen marks (`thread_live_spell`, `thread_seen`) | `thread_live_spell`, `thread_seen` | `threads` |
  | durable effect intents (`terminal_operation`, `worktree_operation`, `thread_target_operation`) | `terminal_intent` (merged with the existing table only if the `executions` card finds one record), `worktree_intent`, `thread_target_intent` | their owners |

  A rename keeps keys, foreign keys, revisions and units unchanged.
  - The three preference tables have one row per principal (per principal and provider for `default_account`), each with its own revision (section 2 D6). They keep F041's covering compare-and-set when `set_thread_model` names `defaultAccount`.
  - `owner_id` becomes `principal_id` only where the column holds the credential principal.
- **Events and feeds** are `area.verb` or `area.noun.verb`, where the area is the owning concept's noun. Feed payload tags are lowercase: the command feed's `Snapshot | Delta` becomes `snapshot | delta` in its wave (same-build app, section 4 §4.4.8).
- **Refusal codes** are kebab-case `<object>-<state>`. New codes use one family per meaning:
  - `<object>-missing` — a needed thing is absent;
  - `<object>-unknown` — a name is not in a known set;
  - `<object>-expected` — a wrong kind was named;
  - `not-found` — an addressed record is absent.

  **Existing codes are frozen.** Clients branch on `code`, so a code in `unblock` text bridges nothing. Two codes are merged only with a selectable answer version (section 4 §4.4.8): the old version keeps answering the old code for its overlap. No merge is planned by this section.
- **Settings keys** are `namespace.camelCase`, where the namespace is the concept, not the module. `agents.offered` → `agent.offered` through section 2 §2.4.9's chain-preserving registry rename (the `threads.archivedProjectionDays` precedent).
- **Wire literals** follow the glossary. The host custody state `'foreign'` (`protocol/machineStanding.ts:102`) becomes `'other'` in the `executions` wave; the app is same-build.
- **Headers and variables** are `Tagma-<Word>` and `TAGMA_<WORD>`.

### 5.4.7 Target names are fixed before the waves — handed to section 7

This section sets the rules and the glossary. It does not rename files one by one.

**Cards.** Section 7 carries a card, with a target file map and a wave task, for every region `names` covers:
- the 27 server modules;
- each package the glossary binds, and each other package whose files are in scope, since every package is its own module (section 1 §1.7);
- the app. A feature aligned with a server module (section 1 §1.7) rides that module's wave. The app's shell, shared UI and routes have their own card.

A region without a card before N0 is not in `names`' gate scope until its card exists. It enters as a tightening.

**Each map lists:**
- every current file of the region → its target path, or its split into named files. For each fragment it names the subject it holds and its dependencies, never a share of lines. A file section 1 splits across modules (appendix A's `split` column) appears in every receiving card, each card naming its part;
- the exported symbols it renames (old → new);
- the glossary words the region owns;
- the `names` debt entries the wave retires, by fingerprint.

The map is written by the wave's designer from the code, under §5.4.1–5.4.6, and reviewed before the wave opens.

- **Builders rename by the plan and never invent.** A file or symbol that the map does not cover is a question to the wave's designer. The builder does not settle it with a name of its own.
- **The map is the debt's owner.** Each `names` debt entry names its card's wave task. The wave closes when its map is applied and its entries are retired (§5.4.9).
- **Worked examples.** They show the shape section 7 fills in. The subjects are hypotheses the designer confirms from the code.
  - `terminals/Terminals.ts` (2,650 lines, `executions`) splits by subject into:
    - `executions/terminals/start.ts` (reservation and start);
    - `executions/terminals/input.ts`;
    - `executions/custody/transfer.ts`;
    - `executions/host/activation.ts`;
    - `executions/commands/…`.
  - `terminals/TerminalStore.ts` (1,767, `executions`) splits into `executions/terminals/store.ts` and `executions/commands/store.ts`, if terminal and command rows are separate subjects. The same basename under two concept directories is honest.
  - `working/Worktrees.ts` (815, `worktrees`) splits into `worktrees/provisioning.ts` and `worktrees/recovery.ts`.
  - `harness/ThreadStore.ts` (1,556) has its primary owner in `native-harness`. Its record reads go to `thread-record`, its catalog and list reads to `threads`, and the facet to `external-harnesses` (section 1 appendix A). Each part is named for its subject, and none keeps `Tagma`.
  - `harness/HarnessSessions.ts` (923) and `harness/HarnessObservations.ts` (785), both `external-harnesses`, become `external-harnesses/sessions/…` and `external-harnesses/observation/…`, with the per-CLI parts under `vendors/<cli>/`.
  - `graph/core/Settings.ts` (548, `settings`) is renamed for what it holds. It splits into store, resolution and history only if those are separate subjects. Graph keeps its `graph.catalogs` write hook and the decided-settings reaction.
  - `harness/TagmaStack.ts` (1,410) dissolves into the module manifests and `composition/root.ts` (section 4).
  - The app's `lib/features/harness/HarnessHost.svelte.ts` (1,440) becomes `lib/features/threads/`: the thread view and its native and external sub-views.

### 5.4.8 The rename plan and its compatibility

| What is renamed | When | Compatibility | Cost to running work |
|---|---|---|---|
| files, directories, TS symbols | in the owning module's wave, by its file map, in the change that moves the code | none needed where no identity is persisted. A rename never leaves a compatibility re-export (rule 8183e6ef) | none. Graph anchors move in the same change (`reanchor_path`; symbol sources re-targeted) |
| module directories | section 1's floor rule: every moving module takes a directory of its own name (`landing/`) | the `modules` snapshot and the graph's `#module` blocks carry the same name | none |
| `Actor.foreign` → `Actor.session`; `KeepWarm`'s `foreign` → `external` | the `invocation` wave (the actor is resolved there) and the `native-harness` wave (keep-warm) | none: in-memory only (§5.3) | none |
| `TerminalActor` → `ActorRef` in the commit queue | the `enforcement` wave | the queue's decoder reads both line formats: the old `Operator | Thread | Foreign` becomes `ActorRef`, with `Foreign{harness, key, projectId}` becoming `session`; new lines are written as `ActorRef`. A decoded line attributes only and grants nothing. Once no old line remains, the old arm is removed. **Downgrade:** an older binary skips new lines with a warning (`CommitQueue.ts:34-66`), losing their commits. Before switching to it, installation runs a preflight: it closes queue admission, and `enforcement` confirms a full drain — no waiting line and no unread line. Otherwise the downgrade is refused (section 2 §2.10), and the old reader never runs over the new format | none; a downgrade waits for the drain |
| `CommandOwner` → `CommandSubject` | the `executions` wave | its stored key form (`ownerKeyOf`: `thread:`, `service:`, `operator`) is unchanged | none |
| two `ViewerId`s → `ScreenViewerId`, `ViewLeaseId` | the `executions` and `execution-host` waves | type names only; wire field names change only with a host wire version (section 2 §2.4.10) | none |
| host `OperationId` → `HostRequestKey` | the `executions` wave | type name only; the value set, the codec, `OperationRef`, receipts and spent keys are unchanged. Narrowing the value set would be a separate breaking migration with the two-way codec of §2.4.10, and none is planned | none |
| wire literal `custody: 'foreign'` → `'other'` | the `executions` wave | same-build app; the CLI's operator output changes in the same change | none |
| tables and columns (§5.4.6 table; `owner_id` → `principal_id` in its credential role) | section 2's migrations: D4 for `thread_mandate`, `external_session` and the `native_thread*` renames; D6 for the `thread_owner_settings` cut and `permission_rule`; the owner's wave for `*_intent`, `worktree_archive_intent` and `merge_receipt` | section 2 §2.10 rollback; keys, foreign keys, revisions and units preserved | none |
| act phase `landed` → `synced` | graph store migration (A5) | section 2 §2.10 | none |
| settings keys (`agents.offered`) | the registry chain | chain-preserving restore (section 2 §2.4.9) | none |
| the native settle result's `landed` → `recorded` (`landedByCall` → `recordedByCall`) | the `native-harness` wave, in one build with its readers | same-build rename of the producer (`operations/nativeJournal.ts:45-63`, `operations/nativeTools.ts:234-245`) and the reader (`projection/toolAnswer.ts:304-310`). The reader keeps reading `landed` in stored results, and no alias or tombstone is used. If the result joins a shared answer of section 4, the change takes an answer version | none |
| commit trailers of the graph's sync | graph's wave | history is immutable: readers accept both spellings, and writers write the `sync` spelling | none |
| act phase in an operation answer | graph's wave | an answer version (section 4 §4.4.8) wherever an answer carries the phase | none |
| operation ids (§5.4.6) and the `operationId` field → `requestKey` | the owner's wave | section 4 §4.4.8: `replaces`/`renamed` for one release, then a tombstone refusing `operation-retired` with the replacement. Old and new resolve to one canonical identity before lookup and digest, and the key's digest stays carrier-free, so receipts persist | none inside the release. After it, a running thread's first call by the old spelling is refused and names the replacement, which costs one extra call. A thread whose frozen instructions name old ids is refreshed by `refresh_thread_instructions`, and delivery reports the retired ids its text mentions |
| agent ids | not renamed: `harness:*` names an external harness's agent, which is the glossary's meaning | — | — |
| socket RPC names, feed tags | the owner's wave | same-build app, reloaded on skew (section 4 K5a) | none |
| refusal codes | frozen | a merge needs a selectable answer version (§5.4.6) | none |
| graph text | the wave that renames also updates the blocks naming the old word or id: `search_blocks` over the old spelling, and each hit is reconciled at its owner | — | none |

**Section 4's `operationId` field.** Section 4 §4.4.6 kept `operationId` as a real field. The glossary gives `operation` one meaning, the catalog entry, so the field becomes `requestKey` through `renamed: {from: 'operationId'}` for one release (A4). This renames the field, not its value set.

### 5.4.9 How it is held: the `names` builtin

A neutral builtin for any project, beside section 1's `modules`, with the language adapter of `code-facts` (JS/TS today).

**What it measures, and what it does not.**
- It measures syntactic facts:
  - file paths and stems;
  - line counts;
  - top-level exports;
  - exported symbol names and their word splits;
  - class members for S6;
  - string literals in tag positions;
  - directory listings.
- It never judges whether a name is **true**. A file named `store.ts` that also judges rules passes every check; the reviewer judges truth against the glossary and the card's map.
- An import is not evidence of meaning. Where the facts cannot settle a question (S4 across modules, S7's reserved words), the rule is a signal.

**Parameters**, set through `enforce_rule`, never through the graph:
- `glossary`: `{word, meaning, owner, regions: [globs], retired: [{sense, pattern, replacement, regions, exceptions}]}`;
- `files`: F1–F7 with their thresholds and exemptions (globs);
- `symbols`: S1–S7 with word limits and the forbidden heads and prefixes;
- `literals`: `[{region, words, positions, allowIn}]`.

**`literals` carries "the graph core names no catalog tag"** (section 1 §1.7, section 8, section 9 §9.13).
- In region `graph/`, it matches a tag id of a shipped catalog (`claim`, `task`, `decision`, …) only in a **tag position**, outside the catalog's own files. Tag positions are:
  - a string literal passed where a tag is read or written;
  - a comparison with a block's tag;
  - a tag-keyed lookup.
- A variable or an English word that happens to be spelt `task` does not match.
- Today's instances (`graph/orientation/Orientation.ts:960-1023`, `protocol/settings.ts:841`) are debt owned by section 9's step 2.

**Measurement model** (section 3 §3.12).
- A judgement reads one **snapshot**: the source tree at the judged revision, together with the rule's parameters at their revision.
- Facts are cached per blob and adapter version, and are reused while those are unchanged.
- A name index by namespace (module, directory, type name, basename) answers the set questions F6, F7, S4 and S7.
- A change judges its **affected set**, not only its changed files:
  - the changed files;
  - the members of each index entry a changed name enters or leaves;
  - for a changed export, territory or glossary parameter, every file whose verdict depends on it.

  A parameter change invalidates the facts it reads, and nothing else.
- **Cost.** A warm run costs the changed bytes plus the affected sets; a cold run costs the bytes actually read.
- An incomplete measurement is `unjudged`, never clean. A gated inspection that cannot run refuses `inspection-failed`, as `submit_work` does today.

**Prerequisite for gate (N0).**
- The builtin has its own retained benchmark before it gates: warm and cold runs over this repository and a synthetic tree at section 1's 1M-LOC target.
- It has an input envelope in files and MiB, per section 3 §3.12, with the refusal it answers past the envelope.
- This section promises no capacity figure before that benchmark exists.

**Strictness.** Gate over the regions that have cards, triggered before `submit_work` and `merge_worktree`, and runnable through `check_rules`.

**Debt.**
- Every violation standing at enforcement is debt. Each entry holds:
  - the rule;
  - the offender: path, symbol, member or word, with F4's line count as its value;
  - its lineage — the entry it continues after a move, rename or split.
- Several violations in one file or symbol are several entries.
- Each entry is owned by the wave task of the card whose map retires it. A file split across modules takes its debt to its primary owner's wave, as section 1's `modules` snapshot does.
- Section 1's rule holds: debt follows the same violation across a move and nowhere else. It does not vanish because a path or name changed, it never passes to a different defect, and a falling total does not retire an entry.

**What the gate refuses:**
- a new violation, whether a new file or symbol, or an old one that grows (F4's value rising);
- a violation carried to a new path, unless its lineage shows it is the same violation.

Watch rules (F4 at 400, F5, F6, F7, S1 at 5 words, S4 across modules, S6, S7's reserved words) are told to the calling thread and never refuse.

**Loosening** — a raised threshold, a new exemption, absorbed debt — is done in the open through `enforce_rule`, as the catalog requires.

**Runlith's own naming rules**, beyond the neutral builtin: the operation, code and settings grammar of §5.4.6, checked by section 4's contract snapshot (K5b) over the catalog.

## 5.5 Owners and boundaries

| What | Owner |
|---|---|
| the glossary (parameters of `names`) | the project: changed through `enforce_rule`, with a word's owner module proposing |
| each word's meaning in code | its owner module (§5.4.1, following section 1 §1.2) |
| each id type | §5.4.3 |
| the `names` builtin, its facts, index and benchmark | `enforcement` (builtins), with the `code-facts` adapter |
| target file maps | section 7's cards: server modules, packages and the app |
| operation, code and settings grammar | the contract snapshot of section 4, over the declaration machinery in `platform` |

## 5.6 Rejected alternatives

- **Retire `harness`, and call external CLIs `foreign` (v1).** It hid a core product concept. The operator ruled that a harness is an agent runtime that runs threads, that Tagma is the native one, and that external harnesses are integrated.
- **`Actor.external` for the session-only arm (v2).** The arm also covers a native session with no project, so "external" would call a native session an external harness. The arm is `session`, and its `SessionRef` names the harness.
- **Keep `delivery` for the git-publishing module (section 1 v10).** "Deliver" would then mean handing things to a thread, the graph's sync and git publishing. The product already calls the activity landing. See A1.
- **Keep "standing" for the thread's authority row.** "Standing" is the graph's product word, delivered to every agent, and three other senses already crowd it.
- **`Harness.active` (Opus, v2.1).** It reads as "a model is working now". The face answers which run or session is held, so it is `current` (Astra).
- **"Environment kinds" (v2) or "environment drivers" (v3) for the implementations.** `EnvironmentKind` already is the `host | sandbox` discriminator (Astra), and "driver" already means what drives a maintenance act (Opus). An implementation behind a kind is a backend.
- **Merge the two `ViewerId`s, `CommandOwner` into `Principal`, or the host key into `RequestKey` (v2).** Each pair shares a spelling or a schema, not an identity. The merge would lose the service subject, refuse live host keys with colons, or join two resources.
- **A split whenever a file is long or exports many names (v2).** Size and count are signals. A split made to meet a number creates fictitious owners.
- **Rename everything now, in one sweep.** It collides with every module's wave and moves each file twice.
- **Let builders choose names in the wave.** That is how today's 284 F2 files and 18 collection-named files were born.
- **A glossary as a document block.** Nothing measures it. As the `names` rule's parameters it is measured, delivered and changed in the open.
- **Ban plurals, or ban `Tagma*` without a replacement** (Astra §5). A plural is right for a collection's owner, and `Tagma*` is a symptom of two thread models.
- **Rename refusal codes to one grammar, or bridge a rename through `unblock` text.** Clients branch on `code`, and prose bridges nothing.
- **A line budget per module**, or none at all. One number is measurable, and each exception goes through `enforce_rule`, visibly.

## 5.7 Acceptance criteria

1. `names` has a retained benchmark and an input envelope, then stands at gate with its first-run debt over every region that has a card. Every entry has an owning wave task and names its offender. In a test fixture, a new F1–F4, S1–S5 or S7(a) violation refuses at `submit_work`, and an unreadable input answers `unjudged`.
2. At the end of the waves, `names` holds no debt for F1, F2, F3 and S2–S5. No file exceeds 600 lines without an explicit, visible `enforce_rule` exemption that states its reason.
3. `floor`, `stack`, `foreign` and `facet` appear in no exported identifier of the covered regions, and neither do `Tagma*` or `*Owner`. No directory is named `harness/`, and `Harness` outside its reserved regions is only a watch signal.
4. The identity types are one each, and none is declared twice within its module:
   - `RequestKey`;
   - `HostRequestKey`, with today's value set;
   - `ScreenViewerId` and `ViewLeaseId`;
   - `Actor`, with the arms `operator`, `thread` and `session`;
   - `ActorRef`;
   - the custody `Principal`;
   - `CommandSubject`.
5. The commit queue reads a file with old `TerminalActor` lines and new `ActorRef` lines, and a decoded line grants nothing. A downgrade across the format is refused unless installation's preflight has closed queue admission and `enforcement` has confirmed no waiting and no unread line.
6. Section 1's 27 module directories stand under the names of §5.4.2 (`landing` for the former `delivery`), in the `modules` snapshot and in the graph's `#module` blocks.
7. The tables of §5.4.6 exist under their names, with keys, foreign keys and revisions preserved, and no table carries `tagma_` or `owner`.
8. Every card in section 7 carries its target file map before its wave opens. Each map covers every file of its region and names each fragment's subject.
9. Renamed operations answer through aliases for one release, then refuse with `operation-retired` naming the replacement; `requestKey` replaces `operationId` the same way, and receipts made under the old id are found under the new one.
10. `literals` refuses a catalog tag literal added to a tag position in `graph/`, and ignores a variable named `task`.

## 5.8 Findings, claims and tasks

- **Answered here:**
  - F042: the glossary; the thread's two models, via sections 1 and 2; `harness`, `host`, `floor`, `standing` and `deliver`.
  - F043: `RequestKey`, `Actor`/`ActorRef` and the three principal roles. `ViewerId` is answered by naming two identities, not by merging them.
  - The `names` check of section 1 §1.7 and section 8 §8.6.
  - "The core names no catalog tag" (section 9 §9.13).
  - Section 1 §1.13's note to this section: every word it asked for is decided in §5.4.1, §5.4.3 and §5.4.6.
- **Tasks:** each card's wave task owns its `names` debt and its file map. The builtin's benchmark and envelope are N0's own work. No other naming task exists.
- **Claims.**
  - Claims whose titles use a retired word, or name a renamed operation or module, are rewritten from the code in the wave that renames.
  - Claims anchored to moved files are re-anchored in the same change.
  - The zone that becomes `external-harnesses`' ([[6ca6b465]], "A foreign CLI run as a thread of Tagma") says "foreign" in its title and body. It is rewritten to "external" when section 8 §8.7 moves it in that module's wave.
  - Claims [[549f1d4b]] (the view lease) and [[95f23a71]] (the principal's value) stand as they are, and this section relies on them.

## 5.9 Build order

Aligned with section 1's waves (§1.5 bottom-up), section 2's D steps, section 3's E steps and section 4's K steps.

1. **N0 (with section 1's `modules` rule and E0/K0).** The `names` builtin (facts, index, F, S and `literals`) in `enforcement`, with its retained benchmark and input envelope. Then the glossary v3 as its parameters, and gate with first-run debt over the regions whose cards exist.
2. **N1 (with section 7).** Every card — server module, package, app — carries its target file map before its wave. A region whose card arrives later enters `names` then, as a tightening.
3. **N2 (each wave).** Its map is applied: files, directories and symbols renamed, moved or split by subject, its debt retired, and graph anchors and text updated in the same change.
   - The `Actor` arm is renamed in `invocation`'s wave.
   - The commit queue's `ActorRef` is renamed in `enforcement`'s wave.
   - `CommandSubject`, `ViewLeaseId`, `HostRequestKey` and the custody literal are renamed in `executions`' wave.
   - `ScreenViewerId` is renamed in `execution-host`'s wave.
4. **N3 (with section 2's D4 and D6).** The table names of §5.4.6, `owner_id` → `principal_id` and the act phase `synced` ride the migrations already planned. `agents.offered` rides the registry chain.
5. **N4 (with K5a and K5b).** Operation renames and the `requestKey` field go through the aliases, and the grammar check enters the contract snapshot.

## 5.10 The remaining questions of rule 8dab19b6

1–9 are §§5.1–5.9.

10. **Contract.** The changes are:
    - three operation groups renamed;
    - the `requestKey` field;
    - the native settle result's `recorded` field (same build, old stored results still read);
    - the declaration field `lifetimes`;
    - lowercase command feed tags;
    - the custody literal `'other'`.

    Each is bridged by section 4 §4.4.8's aliases and `renamed`, or rides the same-build app. No refusal code changes, and agent ids and the host key's value set are unchanged.
11. **Stored data.**
    - The renames of §5.4.6 and the act phase value ride the migrations sections 1 and 2 already plan (D4, D6), preserving keys, foreign keys, revisions and units.
    - The commit queue's file changes its caller format with a reader for both formats (§5.4.8).
    - Rollback follows section 2 §2.10. A downgrade across the queue format passes installation's preflight: queue admission is closed and `enforcement` confirms a full drain, or the downgrade is refused.
    - `names` debt lives in the rule's enforcement document.
12. **Who may do what.**
    - The glossary and thresholds change only through `enforce_rule`, and a loosening asks as its own subject.
    - A card's file map is set by its wave's designer and reviewed before the wave.
    - A wrong gate verdict is loosened in the open with an exemption glob, never by renaming to dodge the measure.
    - A decoded `ActorRef` never grants authority.
13. **Long-lived things.** Aliases live one release, and tombstones stay. Debt entries leave when their violation is gone, and follow it by lineage. The queue's old-format reader leaves when no old line remains.
14. **Bounded resources.**
    - Facts are cached per blob and adapter version, and a warm judgement costs the changed bytes plus the affected sets.
    - The ceiling is the input envelope set by N0's benchmark (§5.4.9). Past it, the answer is a refusal that names the envelope, never a clean verdict.
    - Section 3 §3.12's inspection deadline bounds each run.
15. **Rollout.** A running thread meets a renamed operation through its alias, and after the release through one refused call naming the replacement. Its frozen instructions are refreshed. The app is same-build.
16. **Failures.**
    - A wave that stops half-way leaves its remaining violations as debt, still owned.
    - A rename landed without its graph re-anchoring raises doctor findings that name the moved path.
    - An inspection that cannot finish answers `unjudged`.
17. **Observability.**
    - `names` debt by rule and region, falling per wave.
    - Watch signals by rule.
    - Warm and cold judgement cost against the envelope.
    - Alias and tombstone hits per renamed id, which show when a window can close.
    - The share of commits touching two or more modules (section 1's success metric).

## 5.11 What remains provisional

- `landing` is decided (A1), and it is not provisional.
- **The regions without cards** (packages outside the glossary's list, the app's shell) enter `names` when section 7 writes their cards.

## 5.12 Amendments

Section 1 v10 already made v1's module renames and all module references in sections 2, 3, 4 and 8. The amendments below are only what the glossary adds.

- **A1. Section 1 (f658e190): `delivery` → `landing`**, wherever the name refers to the module:
  - the §1.1 outcome, the §1.2 concept table (landing, merge), the §1.3 row, the §1.5 order, the §1.7 directories and the wave order;
  - the relation registry `spec-01v10-relations.mjs` and the territory `spec-01v10-territory.mjs`;
  - appendices A and B, and the §1.13 amendments to sections 2, 3, 4 and 8.

  The §1.3 row reads: "`landing` — Putting work into a project's git on a thread's or the operator's behalf: landing a session's change, a retiring worktree's leftover work (the preservation landing), merging a worktree into its base, pull requests, the merge queue, and the receipts of each. The graph's commits of its own acts are its syncs." Meaning, boundaries and order are unchanged.
- **A2. Section 1: the thread's "standing" → "mandate".**
  - §1.2's concept row "thread — standing" becomes "thread — mandate", and "the threads standing row" becomes `thread_mandate` in §1.2, §1.13 (section 2 rows) and §1.15.
  - The `Harness` face `standing(thread)` becomes `current(thread)`: the run or session held now, or none. Its outcomes and the guarantees of `quiet`, stopping, reporting and native interrupted-only `continue` are unchanged.
  - "Standing permission rules" keeps its English sense in prose. The table is `permission_rule`.
- **A3. Section 1: "environment providers" → "environment backends".** This covers the workspace hook of §1.4 and §1.15 item 10.
  - The contract is `EnvironmentBackend`, declared by `workspace` and implemented by `executions` (host) and `sandbox` (guest). §1.2's environment row reads "the host backend" and "the guest backend", and Docker behind the guest backend is the container engine.
  - "Driver" keeps only its sense of driving a maintenance act (§5.4.1).
  - The backends keep holding, in-unit admission, state, open, activation, the `OpenRefused`/`OpenLost` distinction and scope release (`workspaces/EnvironmentProviders.ts:32-63`).
  - `EnvironmentKind` stays the discriminator.
- **A4. Section 4 (d925fa0c):**
  - Call **scopes** → **lifetimes**: the declaration field `scopes` → `lifetimes`, `ScopeServices` → `LifetimeServices`, and "the call context" in prose → "the call's services". **Context** stays the native model's, and section 1 rule 7 already calls installation "a lifetime".
  - The canonical call key's "principal" → **actor**: `{actorRef, operation, key}`. It holds the stable `ActorRef`, never the whole `Actor` with its changing reach and act, and two threads of one principal do not share a key space.
  - §4.4.6's "`operationId` stays a field, not an alias" → the field is renamed `requestKey` through `renamed: {from: 'operationId'}` for one release. Old and new operation ids resolve to one canonical identity before lookup and digest.
  - §4.4.3a's actor arm, which section 1 §1.13 left to this section, is `Actor.session`. Its policy is unchanged: not the operator, no run scope, and the client's own approval is not Tagma's verdict.
- **A5. Sections 2 (70083b67) and 3 (511b13e3):**
  - **The graph's P3 commit is a sync.**
    - In §2.4.8, the phase "land" becomes "sync", the act phase `landed` becomes `synced` (`committed | projected | unpublished | conflicted | synced`), "landing commit" becomes "sync commit", and "P3 landing … sets `landed`" becomes "P3 sync … sets `synced`".
    - In §3.11, "P3 capture and landing" becomes "P3 capture and sync".
    - The act phase is a stored value, and section 2's migration of the act table maps `landed` → `synced`. The commit trailers are data in git, and their name follows the same amendment.
  - **The native journal's answer.** `landedByCall` and its answer field `landed: {at, acts}` (`operations/nativeJournal.ts:45-63`, `protocol/toolResult.ts:170`) become `recordedByCall` and `recorded`. This is a same-build rename of the producer and its readers. The reader keeps reading `landed` in stored results, and no alias or tombstone is used, because no request carries the old spelling. An answer version is needed only if the result joins a shared answer.
  - **The bridges.**
    - The stored act phase is migrated, and any operation answer carrying it changes through an answer version.
    - Readers of the commit trailers accept both spellings.
  - `thread_record.owner_id` → `principal_id` (§2.4.4), in the same copy-drop-rename, because it holds the credential principal.
  - The table names of §5.4.6 replace "section 5 names it" in the rows section 1 §1.13 added: the standing row, `external_session`, the archive intent, the merge receipt, and the three tables cut from `thread_owner_settings`. The preference tables keep F041's covering compare-and-set.
  - Durable intent rows named `*_operation` are **intents** in the text. Their tables move to `*_intent` in their owner's wave, where the owner's migration already rewrites them.
