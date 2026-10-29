---
id: 01a118eb-3e7e-7085-8f2e-2cca6433136a
title: Agent-part refactor
ord: 37
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0f01e-4bb5-7965-bbf0-3775175758d8
---
Goal: `packages/agent` and its Tagma assembly become the ground on which plugins, modes, and schemas are later designed without touching the core. Every lifecycle gets one owner, closed lists of extensible variants become contribution points, every core contract speaks Effect, and every fact is derived once at its producer. Mechanisms that are already good stay as they are: transition kernel with keyed acts, the settlement-outbox claim protocol, materialized history with suffix replay, per-thread lanes, zero background cost of an idle thread, conformance suites over the store factory.

## Why

The audit at `9f98ae5672` showed that missing owners, not mechanics, are the blocker:
- seven places assemble the final tool catalog, and the Tagma profile path force-returns `fork_thread` and `ask_user` into any narrowed selection, so "an agent that can only do `look` and `act`" cannot be expressed;
- eleven entries open a run with different semantics (new run, parked continuation, adoption, compaction, hosted), while four services plus SQL decide its end with no shared transition table;
- the core is assembled as a cyclic layer graph closed by `Deferred` services, a hook bag, and ~35 host-config fields;
- the event model has no canonical typed shape, and one fact is derived up to three times between the core and the chat;
- a tool call carries no caller, and MCP gets `callTool({ name, arguments })` with no `_meta`;
- modes and policy are closed lists.

The ten files in the [[6b3210c7|650-line rule]] debt (task [[175758d8]]) are the trace of those gaps, not their cause.

## Boundaries

In: `packages/agent`; its Tagma assembly — `apps/tagma/server/src/native-harness` (module [[ab05dfec]], including `tools/mcpServers.ts`) and `apps/tagma/server/src/threads/harness` (module [[1a45453a]]); the MCP call path — `packages/mcp` (module [[13756ad0]]). The shared seams plugins will need are also in: caller identity, wake-up and thread status from outside, contribution registries.

Out, by the operator's word: everything plugin-specific — the `plugins` module, manifest, widget host, origins, the `postMessage` bridge, SDK, any concrete plugin design. That is built after the refactor on top of its seams (ideas [[21acc718|plugins]] and [[9caf5753|poker]]). The runtime→chat contract's consumer side is the chat spec under [[cb732496]]; the event model is defined once here, in [[c3436715]].

## Principles every child holds

1. Every lifecycle — run, question, tool call, compaction, agent tree — has one owner holding its state machine.
2. Everything a mode or plugin adds arrives through a contribution point with id space, order, thread opt-in, diagnostics, and removal (registration returns disposal). The core is never edited for a new variant.
3. Core contracts are Effect-only; Promise and `AbortSignal` live on provider edges (SDK, fetch), adapted once.
4. One canonical decoded event model; projections derive from it once, at the producer.
5. The host passes named ports as Layers; the core never resolves its own services late through `Deferred` (a waiting question's Deferred or a deduplicated recovery's is legitimate mechanics — untouched).
6. No failure is swallowed: every outcome is a typed answer or an event someone reads.

## Parts

Each is a separate spec with its own criteria:
- [[523c3230]] — suites in the package against `InMemory*` plus SQLite;
- [[8451c5c9]] — the run's tool catalog: one function, only the definition's grant plus `deny`;
- [[b771b4db]] — the caller in every tool call, the thread's `bindings`, `_meta` in MCP;
- [[9f3bb3f9]] — waking a thread and its outside status: `RunStatus`, `RunReceipt`, outside caller at Tagma doors;
- [[7e9130bd]] — run lifecycle: one owner, a states × acts table, no silent holes;
- [[a34152ed]] — opening a run: one `admit` instead of eleven roads, assembly from one read;
- [[fb39e560]] — questions and confirmations: one core for native and hosted;
- [[7337d0bb]] — cycle-free core assembly: `Commands.ts` dissolves, host config by ports;
- [[bb429da3]] — contribution registries: modes, rules, Tagma capabilities; one effective-definition owner;
- [[9bc6e931]] — the tool door by subjects;
- [[c3436715]] — the runtime→chat event model;
- [[69dafa08]] — Effect-only contracts and store ports;
- [[87916291]] — collaboration: tree, delivery, reports, outside sender, fan-in O(C);
- [[b0203ef2]] — compaction by subjects: typed refusals, strategies with `off`, flat step cost;
- [[9035b0a1]] — scale: a 100-thread tournament bench with linear bounds;
- [[9116e494]] — transports: native, ACP, and terminal as adapters behind one core contract, with one meaning for the user.

## Whole-rework acceptance criteria

Each is checked by code, test, or measurement; the owning child is named in brackets.
1. One `resolveCatalog` function builds the run catalog, and an agent holds exactly the tools its definition issues: nothing outside the definition adds any. Built-in agents enumerate in their definitions what users see today. A definition with grant `{look, act}` yields exactly `{look, act}` on the native road, the hosted road, after context restore, and after deferred-discovery; calling an unissued name is refused by the door ([[8451c5c9]]).
2. `PermissionVerdict` is `allow | ask | deny`. An unconditional `deny` removes the tool from the model catalog with a reason; a conditional `deny` refuses the concrete call. Grant, deferred-tool exposure, and an accepted call's receipt are different states of one admission ([[8451c5c9]]).
3. Every tool call carries a `caller` filled by Tagma, not the model; the MCP server gets it in `params._meta` — checked by a wire-request test ([[b771b4db]]).
4. The run lifecycle has one `RunLifecycle` owner with the states × acts contract written in [[7e9130bd]]: ownership conditions, the expected run id, and each transition's durable effect, including handover, adopt, parking, and continue. Conformance on both adapters checks every row and the races ([[7e9130bd]]).
5. One act wakes a thread — `admit(threadId, item, caller, key) → RunReceipt`; there is no other road for an outside caller. A new run, a parked continuation, adoption, and a compaction run stay different acts of the lifecycle table inside, but all enter through `RunScheduler` ([[a34152ed]], [[9f3bb3f9]]).
6. The core assembles with no cycle: neither in `packages/agent/src` nor in `apps/tagma/server/src/native-harness` does any service take another through a late-filled `Deferred` (`late()`, `KernelOpening`), and `thread/run` imports nothing from `collaboration/` ([[7337d0bb]]).
7. Closed lists become registries: modes, rules, tool sources, Tagma capabilities, compaction strategies, event kinds, and data-parts. Every registry declares its contribution-removal semantics. A new mode, source, or event kind is added by one registration in one file — a test checks that ([[8451c5c9]], [[bb429da3]], [[b0203ef2]], [[c3436715]]).
8. One typed event model:
   - a decoded union on ingress, closed over the established kinds;
   - `ThreadToolState` as a union with one settlement projector;
   - exactly one `run-end` per terminal run with records (withdraw removes the visible records, with no `run-end`);
   - the live tail as incremental entry deltas with an agreed cut and resnapshot on overflow.

   The "call finished / failed / run ended" fact is derived in one place ([[c3436715]]).
9. Effect-only contracts: core contracts (`Tool`, `Agent`, `thread/` services) have no Promise members, and the package's production code has no `Effect.runPromise`/`runSync`/`runFork` except the named provider edges and the host's one entry point. Store ports are declared on Effect; Promise shapes, the `portFaces` Proxy, and `CALLBACK_AT` are deleted ([[69dafa08]]).
10. No silent holes:
    - no `console.*` in the package's production code;
    - a response-changing failure is a typed refusal or handled by its own condition, and a `swallowed-failures` allowance stands only on best-effort cleanup, telemetry, or release with a why;
    - settlement-delivery exhaustion, resume failure, stale ownership evidence, and compaction failure are typed outcomes visible in reads ([[7e9130bd]], [[b0203ef2]], [[69dafa08]]).
11. A tournament bench with a fake provider, with completions delivered singly and in batches under the same scenario, counts calls, rows and bytes read, records processed, and bytes sent.
    - A full report collection grows O(C + R) in children and new reports.
    - A warm re-wake and an ordinary step read only the needed suffix; a cold assembly reads the necessary materialized context once and is measured separately. No whole team is re-read over one child's change.
    - Sizes are minimal yet separate linear from quadratic growth; 100 threads is the tournament-shape scenario ([[9035b0a1]], [[87916291]]).
12. No `packages/agent` source file counted by the [[6b3210c7|650-line rule]] exceeds 650 lines without imports. `read_enforcement` on [[6b3210c7]] shows no debt for [[175758d8]], and changes add no debt in the touched Tagma modules.
13. Every thread and workflow storage/runtime conformance contract runs from the same suite files in the package against `InMemory*` and in Tagma against SQLite ([[523c3230]]).
14. Every child changing durable state migrates it once, preserving in-flight work, and its acceptance includes a database holding such work ([[acb620dd]]).

What the operator checks, not the implementer: the bench run on their own machine and the poker tournament on plugins after the refactor. That conditions no task's closure.

## Debt and task [[175758d8]]

The task owns the ten debt records and closes when the last one disappears. Each file goes to the child that gives its subject an owner:

| File (lines without imports at `9f98ae5672`) | Goes to |
|---|---|
| `thread/conformance/runLog.ts` (4592), `storagePort.ts` (1496), `compactionRequests.ts` (975) | [[523c3230]] |
| `thread/run/ThreadRunLease.ts` (729) | [[7e9130bd]] |
| `thread/run/ThreadTurnRunner.ts` (803), `ThreadAggregate.ts` (725) | [[a34152ed]] |
| `thread/run/Commands.ts` (1027) | [[7337d0bb]] |
| `agent/AgentToolDoor.ts` (1208) | [[9bc6e931]] |
| `collaboration/ThreadEnvelopes.ts` (750) | [[87916291]] |
| `thread/run/ThreadCompaction.ts` (1082) | [[b0203ef2]] |

## Modules touched

- [[ab05dfec]] — Tagma's own harness: `kernel.ts`, `composeAgent`, the capability table, calibration, assembly order.
- [[1a45453a]] — agent threads and sessions: `engine.ts` with the `AgentHarness` config, feed ingress and operations, the outside caller at doors.
- [[13756ad0]] — MCP servers: `_meta` on the wire, ping, and reconcile.
- [[287a4906]] — foreign CLIs as Tagma threads: the ACP adapter translates tool calls into typed records, the hosted road unifies with native ([[fb39e560]]).
- [[cb732496]] — chat: the event-model consumer; its spec references [[c3436715]] and deletes its own live-chunk projection and finalization.
- The workflow-run store and the `promise/` fixtures in Tagma — when port contracts move to Effect ([[69dafa08]]).

## Build order

The table separates starting independent code from finishing a child. The dependency column names the contracts without which the child's criteria cannot be proven. A shared contract and its consumers change in one cut under one owner; until its child, the contract is filled by today's implementation.

| Child | Finishes after | Why |
|---|---|---|
| [[523c3230]] | — | fast signal for every next step |
| [[8451c5c9]], [[b771b4db]] | [[523c3230]] | they remove two poker blockers on the current structure |
| [[9f3bb3f9]] | [[523c3230]]; end reads — [[7e9130bd]] | `admit` and `statuses` start at once, `admit` first picks among today's roads |
| [[7e9130bd]] | [[523c3230]] | the transition and durable-endings contract |
| [[c3436715]] | [[7e9130bd]] | the terminal projection takes ending from the transition contract; the event contract and its consumers are one cut, in parallel with the chat spec |
| [[a34152ed]] | [[7e9130bd]], [[8451c5c9]] | admits against the transition contract, assembles the catalog via `resolveCatalog` |
| [[9bc6e931]] | [[8451c5c9]], [[b771b4db]] | declares the confirmation and mode-verdict ports on its floor |
| [[7337d0bb]] | [[a34152ed]], [[8451c5c9]] | admission policy moves to the scheduler, the `ThreadRuns` filler stays above it, `featureLayers` moves into the source registry; the native tree adapter is created in the same cut |
| [[fb39e560]] | [[9bc6e931]], [[7e9130bd]], [[a34152ed]], [[bb429da3]] | fills the door's confirmation port, uses `ApprovalParking`, `RunAssembly.hosted`, and the mode's `onEnter` |
| [[bb429da3]] | [[9bc6e931]], [[7337d0bb]] | modes fill the door's verdict port; Tagma capabilities assemble in the new build |
| [[69dafa08]] | [[7337d0bb]] | ports split by subjects before their contract changes shape |
| [[87916291]] | [[7337d0bb]], [[b771b4db]] | splits the native tree adapter, the sender with `caller` |
| [[b0203ef2]] | [[a34152ed]], [[bb429da3]] | compaction runs open through the scheduler; the effective definition picks the strategy |
| [[9035b0a1]] | every other child | measures the final shape |

Independent children go in parallel. Every cut changing a shared contract changes the declaration and all consumers together, under one owner.

## Coverage

Every audit finding gets an owner or an explicitly accepted exception:

| Finding | Resolved in |
|---|---|
| F1 catalog | [[8451c5c9]] |
| F2 run opening and end | [[7e9130bd]], [[a34152ed]] |
| F3 cyclic assembly | [[7337d0bb]] |
| F4 event model | [[c3436715]] |
| F5 caller; Promise members | [[b771b4db]]; [[69dafa08]] |
| F6 modes and policy | [[bb429da3]] |
| F7 scale | [[87916291]] (report collection), [[a34152ed]] (opening), [[b0203ef2]] (meter, calibration), [[9035b0a1]] (MCP, drain, maps, bench); no model-call concurrency cap, by the operator's decision |
| F8 Effect at boundaries | [[69dafa08]] |
| F9 silent holes | [[7e9130bd]] (settlement, resume, heartbeat), [[b0203ef2]], [[fb39e560]], [[bb429da3]] (withdrawn kind's resource), [[87916291]] (residency) |
| F10 two question subjects | [[fb39e560]] |
| F11 outside sender | [[87916291]] |
| F12 compaction | [[b0203ef2]] |
| F13 door | [[9bc6e931]] (`afterTool` is the call-outcome stage) |
| F14 one fact, two writers | [[a34152ed]] (thread model), [[c3436715]] (run end, call state) |
| F15 tests | [[523c3230]] |
| F16 workflow | [[9035b0a1]] |
| F17 small | positional dependencies — in [[9bc6e931]], [[7337d0bb]], [[b0203ef2]]; the `AgentGuidanceJournal` Pick-slice and the `ThreadTypeCatalog` microfile — with their owners as encountered; core voice — see below |

Core voice (`AgentTurn.ts:411-414,473-479`, `AgentCalls.ts:36-49`): words describing the core's own mechanics (a stopped call, an exhausted step) stay in the core — those are its facts. Words carrying Tagma policy move to the host port via [[e090f46d]] in the cut that touches them. This rework builds no separate voice seam for modes.

Outside the rework:
- User interface — the rework changes nothing the operator sees except disappearing live/durable divergences. Chat UI is the spec under [[cb732496]].
- Outside-caller authentication — under [[06e41b6f]] it is not built against our own agents (open question 2).
- Agent tools for workflow are a feature, not a seam.

## Open questions for the operator

Only what changes visible user behavior, product scope, or authority goes to the operator. The spec author decides technical means with the reviewer: as clean and native as possible, no duplicates, no invented machinery.

Decided:
- An agent holds exactly the tools its definition issues; there is no forced mechanism. Built-in agents enumerate today's set in their definitions ([[8451c5c9]]).
- The hosted road (ACP) works like native: questions, confirmations, and lifecycle edges unify now ([[fb39e560]]).
- Core contracts and store ports are declared on Effect; Promise shapes, the `portFaces` Proxy, and `CALLBACK_AT` are deleted ([[69dafa08]]).
- Model-call concurrency is unlimited: no gate, no tree capacity. Provider rate-limit answers are handled as today ([[9035b0a1]]).

Open on future outside authors:

1. **"No versions" rule versus a stable plugin contract.** The event model, `RunStatus`, `ToolCaller`, and the registries will become a contract plugins depend on. While plugins live in the monorepo, one shape plus a same-commit migration is enough; outside authors will need an exception to [[acb620dd]]. Decide when that arrives.
2. **Trust in plugin identity.** `caller` in `_meta` attributes a call but does not protect it. Authentication at the Tagma door for outside plugins is out of this rework.
