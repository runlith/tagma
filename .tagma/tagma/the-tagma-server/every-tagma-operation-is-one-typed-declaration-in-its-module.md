---
id: 01a0e2ed-be23-7fd5-882c-a6edd925fa0c
title: Every Tagma operation is one typed declaration in its module — input, answer, refusals, write identity, lifetimes, deadline — run with one set of call services, and every door is a projection of it with the same meaning
ord: 54
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
# Tagma architecture spec · Section 4. Contract — draft v3

**Amended by §3.13 ([[9c085c6c]], its §3.13.15):** door code `act-spent` for every keyed write; owner records gain `thread_call` and the tombstone lookup; inbox receipts gain `request_digest`. §3.13 governs where this text differs.

**Amended by section 5 ([[243fd181]]), approved by the operator:** the call's levels are **lifetimes** — the declaration field `lifetimes`, `LifetimeServices`, and "the call's services" in place of "call context"; **context** is the native model's. The canonical call key is `{actorRef, operation, key}`: it holds the stable `ActorRef`, never the whole `Actor`, and old and new operation ids resolve to one identity before lookup and digest. The `operationId` field becomes `requestKey` through `renamed: {from: 'operationId'}` for one release. The session-only actor arm is `Actor.session`. `FileScope` is the **file reach**; the module `delivery` is `landing`; the graph's P3 commit is its sync. Version notes above §4.1 keep the words they were written with.

**Amended by section 1 v10 ([[f658e190]]), approved by the operator:** `check_rules` is one operation owned by `enforcement` over change-record's prepared change, with no port — §4.4.9's placement in `worktrees` and the §4.11 amendment to section 1 are withdrawn; `update_worktree` moves to `threads`, and the finishing operations split between `worktrees` (lifecycle) and `delivery` (landing, merge, PR); the run scope, `ThreadExecution` (with an `afterEdit` ingress for standalone world tools) and `set_thread_model` move to `native-harness`; adopted sessions and the external principal belong to `external-harnesses`; the installation scope is a lifetime owners contribute to; manifests carry section 1's new contributions; operation owners follow section 1 v10. Each change is marked where it applies; section 1 v10 §1.13 is the source.

**v3:** answers `spec-review-04v2-arch-{opus,astra}.md`. Every point holds and is taken; nothing is rejected. Changes:
- `revision` fields are optional for one release (Opus);
- deadlines are the sum of the waits an operation declares, with no flat `ordinary` figure (Opus, §4.4.2a);
- a `manual` settle answers `unknown` when it cannot prove the earlier act (S4-1);
- F041: two writes under covering compare-and-sets, with the thread's account kept out of the defaults (S4-1);
- physical keys encode the whole canonical key, and the digest excludes key carriers (S4-2);
- a non-adopted foreign principal gets the operator's grants for its harness, or `approval-required` (S4-4);
- a selectable answer version bridges a breaking answer under the same id, and ships in K5a before K4 (S4-5/S4-6);
- `check_rules` retains its judgement and pages every set from it, and its verdict is computed over the full result (S4-8);
- `merge_worktree` keeps section 3's try-admit roads, and its executing road is a landing (S4-10; no amendment to section 3 needed).

**v2:** answers `spec-review-04-arch-{opus,astra}.md`; every finding holds and is taken, and nothing is rejected. Changes:
- write identity (§4.4.6), for B1 and S4-1/S4-2: the caller's key first, `operationId` kept, canonical call keys, carriers per door, spawn and send keyed, `natural` replaced by `revision | manual`;
- deadlines derived from §3.12 per kind, with the list (§4.4.2a, B2);
- per-call lens, origin, consent and provenance (§4.4.2, S4-3);
- the permission protocol at every door, and the callback origin (§4.4.3a, S4-4);
- `stalled` over HTTP is 409 and nothing retries automatically (§4.4.5);
- open answers with an unknown-arm fallback, outcome metadata on the wire, MCP `outputSchema` (§4.4.1, §4.4.8);
- submit's `nothing` stays a success;
- `contract-skew` withdrawn; hooks and named verbs never blocked;
- rollout order: discovery and skew handling before any route retires, with the honest minimum range (§4.4.8, §4.9; S4-5);
- the snapshot's limits and the registration inventory (§4.4.8, §4.4.11; S4-6/S4-7);
- bounded answers beyond pages (§4.4.10, S4-8);
- freshness in the `sync_graph` interim fix (§4.8, S4-9);
- F041's exact semantics (§4.4.7);
- test-only parity cases within the layer budgets (§4.4.11);
- an explicit amendment to section 1 (§4.11), since withdrawn by section 1 v10 ([[f658e190]]).

**Question answered:** how an operation is declared, reached and answered. Code read at HEAD `0ff63c1651`. Builds on section 1 ([[f658e190]]), section 2 (`70083b67`), section 3 (`511b13e3`), section 8 (`e04cfdcb`) and section 9 (`6bf40362`). It reopens none of them except §4.11, which section 1 §1.8 delegated here. The inventory behind the counts is `contract-facts.md` in this thread's scratch.

## 4.1 Outcome

- **One declaration per operation.** It holds:
  - the input and the **answer**;
  - the refusals;
  - the rule-trigger subject;
  - the effect class;
  - the write identity;
  - the whole-call deadline;
  - the paging family;
  - the call lifetimes it needs;
  - the doors and audience it is offered to.

  It lives in its module's `contract/wire`. The body lives beside it in the module, and the module's manifest pairs them.
- **One admission and one set of call services per call.** Every door hands `invocation` a credential, the callback origin and a request. `invocation` resolves identity through the owners of the facts, assembles the call from the lifetime owners of section 1 rule 7, runs `prepare → verdict → execute`, and encodes one outcome.
  - No door reads a table.
  - No door composes owners.
  - No capability is absent by default. A call that lacks a lifetime it needs is refused before the body runs, with a typed refusal.
- **Doors are projections.** The native tool, HTTP, socket, CLI and MCP doors differ only in framing, credential transport, how a permission verdict is obtained, streaming and rendering. For one credential, one verdict, one input and one state they give the same outcome class, answer value, refusal code with its `unblock`, owner scope and journal effects. REST parity is defined this way and tested over the whole catalog.
- **Every central list is derived** from the union of module manifests. A module inventory proves nothing declared is left unregistered. A new operation changes only its own module's files (section 1 §1.7).
- **Answers come in four classes, one shape per class at every door:** answer, refusal, unsettled (`stalled`) and defect. A fifth, connection loss, is the client's, recovered through the write's key.
- **Retry safety is declared, never assumed.** A write is keyed by the caller's own key when given, else by the door's call id; or it is revision-guarded; or it is marked manual and never retried automatically.
- **Changes stay compatible.** Additive changes need nothing. Answers are open, with a fallback arm. A breaking change keeps an alias for one release, then a tombstone. Clients learn the catalog from the server, so an older CLI or MCP bridge keeps working.
- **`check_rules` is one operation, owned by `enforcement`** (§4.4.9); section 1 v10 ([[f658e190]]) carries the placement.

## 4.2 Problem, with evidence

1. **The declaration has no answer (F034).** `protocol/operations/shape.ts:19-31` declares `params`, `refusals`, confirmation, presentation and subjects, but no answer schema. The generic route is `Unknown → Unknown` (`api/operations.ts:20-28`), so the dynamic road can only coerce values to JSON (`operations/perform.ts:79-98`).
2. **The HTTP door is a second vocabulary (F034, F008).** 239 endpoints in 36 `api/*.ts` files; 25 handler modules call `performHttp` 172 times. Typed handlers never apply the body's `answer` (`http/operationBinding.ts:103-110` → `perform.ts:47-52`), while the native door (`operations/nativeTools.ts:218`) and `/api/op` (`handlers/operations.ts:34-38`) do. Divergences:
   - `edit_block` renames `oldString/newString/replaceAll` to `old/new/all` and answers `wireWritten` (`handlers/blocks.ts:115-125`, `http/wire.ts:8-12`).
   - `start_terminal` defaults `program` and `geometry` and drops `{status:'ok'}` (`handlers/terminals.ts:158-178`).
   - `measure.doctor` merges three operations (`api/operations.ts:65-67`, `handlers/measure.ts:42-82`).

   `HTTP_OPERATIONS` (`api/operations.ts:54-203`) asserts bindings it cannot check. F008, where `write_setting` ran another body, is fixed at the handler (`handlers/settings.ts:52-62`, claim c0c913f5), but its cause stands.
3. **Each door assembles owners and context its own way (F035, F038).**
   - Native merges the whole `ThreadOwners` locator (`operations/nativeOwners.ts:31-117`, `harness/ThreadContext.ts:75`).
   - HTTP builds another set (`http/handlers/handlers.ts:152-241`, `http/operationBinding.ts:38-86`, extra lists at `handlers.ts:320-342`).
   - The dynamic seam erases `R` (`perform.ts:54-61`).
   - HTTP runs every thread caller with `ActingRun {runId: null}` (`handlers.ts:211,327,339`); native passes the run (`nativeOwners.ts:94`).
4. **A missing binding reads as a domain state (F001, task 37439dcf).** `sync_graph` reads `TreeCommits` (`operations/projects.ts:176-184`), a `Context.Reference` defaulting to `undefined` (`files/TreeCommits.ts:49-51`) that `syncGraph` reads as "not a team tree" (`:59-64`). HTTP provides the served graph per routed-service method, not around the body (`http/GraphRouting.ts:188-201`). Other service references default to `null` the same way: `CurrentGraph`, `ServedGraphs` (`GraphRouting.ts:37-43`) and `SignedCall` (`graph/projects/Sessions.ts:16`).
5. **The transport resolves identity by reading tables (F036).**
   - `http/caller.ts` reads `thread`, `thread_run` and `terminal` (`:15-16`, `:63-124`).
   - It decides actor, project, lens and workspace itself (`:171-288`).
   - `protocol/caller.ts:1-64` mixes `ProjectCall` with `WorkingOrigin`.
   - Socket terminal channels import `actorOf` from an HTTP handler (`socket/terminalChannel.ts:24`, `socket/commandBytesChannel.ts:6`).
6. **Five filter lists stand in for "doors":**
   - `SOCKET_ONLY_OPERATIONS`, `OPERATOR_ONLY_OPERATIONS`, `AGENT_COMMAND_OPERATION_IDS` (`protocol/operations/index.ts:98-104`);
   - `PerformOnlyOperationId` (`api/operations.ts:40-50`);
   - MCP's `SERVED` (`operations/mcpTools.ts:26-30`).
7. **The socket and CLI bypass operations.**
   - Socket: 33 verbs, 16 of them streams, none dispatching through an operation body (`socket/*Channel.ts`, `socket/live.ts:71-107`).
   - CLI: 40 verbs from 20 sources (`cli/verbs.ts:27-68`); four reach operations.
   - `tagma op` and `mcp-serve` look operations up in the **client's own** compiled catalog (`cli/commands/op.ts:44-50,143-166`; `api/operations.ts:16-22`; `operations/mcpTools.ts:25-48,113-127`), so an older client refuses a newer id before the network.
8. **Failure shapes differ by door.**
   - Native: a prepare refusal is `ToolFailed` text, an execute refusal is `{status:'refused'}`, anything else dies (`nativeTools.ts:77-99,200-231`).
   - HTTP: 409, 404 on about 30 `missingSchema` endpoints (`api/threads.ts`, `api/agents.ts`), 500 `server-fault` (`protocol/refusal.ts:117-125`, `handlers/answering.ts:12-37`).
   - CLI: exit 2 or 1, plus the codes of `op` and `check` (`cli/exit.ts:27-32`, `commands/op.ts:175-176`, `commands/check.ts:14`).
   - MCP: `isError` with `structuredContent` (`cli/commands/mcpServe.ts:20-56`).
9. **Retry keys are uneven.**
   - The native door provides `SignedCall` from the provider's tool id (`nativeTools.ts:215`), and the journal looks it up together with the session (`graph/journal/Journal.ts:262-270`).
   - Over HTTP, MCP and CLI, `SignedCall` stays `null`.
   - Terminal, command and worktree acts take a caller-chosen `operationId` ("chosen BEFORE the call and kept. The same name answers the same act", `protocol/operations/terminals.ts:13-15`).
   - A spawn is keyed by its request id (`envelope:spawn:<requestId>`, `harness/HarnessBirths.ts:119-149`).
   - `send_message` and `send_task` mint a random envelope id (`packages/agent/src/collaboration/ThreadEnvelopes.ts:848`), so a repeated call makes a second message.
10. **Permission verdicts exist only on the native door.** Approval sits between `prepare` and `execute` over the same prepared value (`nativeTools.ts:200-215`). HTTP gives a thread caller `CallConsent.none` (`http/caller.ts:456-457`), and sensitive terminal and command bodies refuse that road on purpose (`terminals/terminalAsk.ts:12-24,50-65`).
11. **Central lists are edited by every feature (F037):**
    - `OPERATIONS`, `OPERATION_IDS` (`protocol/operations/index.ts:28-96`);
    - `OPERATION_BODIES` (`operations/index.ts:25-45`);
    - `HTTP_OPERATIONS`, `VERB_SOURCE`;
    - `CAPABILITY_IDS` (13, `harness/capabilities/Capability.ts:12-26`);
    - `SETTING_KEYS` (89, `protocol/settings.ts:1794-1884`);
    - 73 server `exports`.

    Commits over 30 days: `api/operations.ts` 59, `handlers.ts` 68, `protocol/settings.ts` 98 (arch-opus P3).
12. **Nothing is versioned.** Server, CLI and MCP bridge all report `VERSION = '0.1.0'` (`protocol/installation.ts:18`), the CLI compares no builds (`cli/door.ts:204-212`), and the app reloads nothing on skew.
13. **Answers are bounded only in their rows.** `check_rules` returns every fingerprint, rule, unjudged specifier and path beside a paged list of violations (`operations/enforcement.ts:177-212,246-275`). Page families' row sizes are representative measurements, not upper bounds (`protocol/pageFamilies.ts:14-57`).
14. **The app composes one intent from two writes (F041).** `HarnessHost.writeModelSettings` writes the owner's defaults, then the thread (`HarnessHost.svelte.ts:1297-1314`); `#applySwitch` does it in the other order (`:797-833`).

## 4.3 What holds now, checked against the code

- **The id catalog is total today.** `OPERATION_IDS` (`protocol/operations/index.ts:79-96`) is an independent union, so `OPERATION_BODIES satisfies Record<OperationId, AnyBound>` (`operations/index.ts:45`) forces a body for every declared id, and `HTTP_OPERATIONS` stops the build for an unbound id (claim 5b495b46). §4.4.11 keeps an independent inventory for this reason.
- **`prepare` and `execute` are split.** The permission verdict judges the prepared value, and execute reuses it (claim 15d24292). A body's `reads` (`operations/bound.ts:25`) are judged beside the subjects (`nativeTools.ts:183-185`).
- **Rule-trigger subjects are declared beside the catalog** (claim 34501c09), with its limitation: a write without `mutates` counts as a HEAD subject.
- **Refusal contract.** `GateRefusal {code, reason, unblock (non-empty), inputFile?}` (`protocol/refusal.ts:3-21`). The socket and HTTP share `refusing()` (`graph/core/refusal.ts:5-21`).
- **Paging families** (`protocol/pageFamilies.ts:207-241`, about 22 operations) follow rule 68659e3b.
- **The app's client is generated:** `HttpApiClient.make(Api)` (`app/src/lib/wire/Door.ts:10`). About 20 request types are still mirrored by hand across 14 `*Repo.ts` files. All 62 `@tagma/server` specifiers are browser-safe by the import graph.
- **Tool catalogs are composed per turn** (`harness/nativeCatalog.ts:5`, `harness/capabilities/Capability.ts:47-48`). Instruction text is frozen until `refresh_thread_instructions` (`ThreadActs.ts:656-700`).
- **The act header is provenance, not a live run.** `http/caller.ts:114-129` checks that the run belongs to the thread, not that it runs. A shell command may outlive its run (claim e3331ccd).
- **Installed commit hooks call the named verb `check`** (`enforcement/commitHooks.ts:41,50,70`). The agent's `prepare-commit-msg` requires `clean`.
- **The F041 writes are two tables of one owner, `threads`.** The thread's selection is in `thread` (`db/thread.ts:68-72`), written by `ThreadAggregate.setModelSettings` (`packages/agent/src/thread/ThreadAggregate.ts:757-768`). The owner's defaults are in `thread_owner_settings` (`db/thread.ts:424-437`), written by `ThreadOwnerSettingsStore.saveModelSelection` (`thread/ThreadOwnerSettingsStore.ts:145-208`). A null `account` leaves the default account unchanged (`:163-166`). The app sends the thread the chosen account but the defaults `account: null` (`HarnessHost.svelte.ts:1311-1322`), so choosing an account for one thread never moves the default account.
- **Parity tests are samples:** `operationParity.itest.ts` covers `edit_block`; `commandParity.itest.ts` covers three command operations and one read.

## 4.4 Target model

### 4.4.1 The operation declaration

A declaration is data in the owning module's `contract/wire`, so it is browser-safe. Server-only parts sit beside the body.

```ts
// <module>/contract/wire/operations/<family>.ts
export const readBlock = operation('read_block', {
  meaning, grammar,                       // text: rendered, never pinned by tests (f0530b87)
  input:   Schema.Struct({ … }),
  answer:  arms({ ok, … }),               // status-tagged; open (see below)
  negative?: ['refused'],                 // arms meaning "the act did not land"
  refusals: ['not-found', 'ambiguous-name', …] as const,
  effect:  'read',                        // 'read' | 'write' | 'external'
  intent?: 'destructive',
  subject: 'head',                        // 'head' | 'tree' | 'file' | 'none'
  identity: 'none',                       // reads: 'none'; writes: { key } | 'revision' | 'manual' (§4.4.6)
  waits:   ['ticket', 'tree-permit', 'unit'],  // §3.12 waits it may enter; deadline = their sum (§4.4.2a)
  deadline?: DeadlineKind,                // only for the kinds of §4.4.2a that are not a sum
  page?:   BLOCKS,                        // a 68659e3b family
  bounds?: { … },                         // caps of unpaged variable fields (§4.4.10)
  lifetimes:  ['workspace'],                 // beyond installation and call
  doors:   { agent: true, mcp: true, http: true, cli: 'op' },
  audience: 'any',                        // 'any' | 'thread' | 'operator'
  confirmation, confirmLabel, presentation, subjects,   // the permission face, pure over input and prepared
});

// <module>/operations/readBlock.ts: server-only
export const readBlockBody = body(readBlock, { prepare?, reads?, execute, voice?, settle? });
```

| Field | Decides | Replaces |
|---|---|---|
| `input` | the only decoder at every door; a failure is `field-invalid` naming the path | per-route payload schemas |
| `answer` | the typed success at every door; `execute`'s value must be assignable to it, and the `saying` mapping is folded into the body | `Unknown` success, `answerOf`, `wire*` reshaping |
| `negative` | the arms after which the CLI exits 1 and the wire's outcome metadata says `negative` (§4.4.5) | `refusedSubmission` (`op.ts:83-88`), `CHECK_EXIT` |
| `refusals` | the codes the body may raise (`Refused<K>`, `bound.ts:13-15`); door-level codes are added by type (§4.4.5) | kept |
| `effect` | MCP hints, CLI confirmation, whether `identity` must be a write identity | `mutates` |
| `subject` | what a trigger judges (claim 34501c09) | the `checks`/`mutates` inference |
| `identity` | how a retry is made safe (§4.4.6) | `settles`, ad-hoc keys |
| `deadline` | the whole-call deadline kind (§4.4.2a) | nothing today |
| `page`, `bounds` | the derived limit, cursor, total and next; the caps of every other variable field | per-operation `limit`/`cursor` |
| `lifetimes`, `audience` | which call lifetimes the body may use; who may call | merged owner sets, the five lists |
| `doors` | where it is offered | the five lists |

- **Answers are open.** `arms(…)` builds the declared union plus a fallback arm `{status: string}` with its other fields kept, so a decoder built from an older declaration accepts an arm it does not know instead of failing. Every generated client, `tagma op` and the app decode through `arms`. A known arm is decoded strictly.
- **Negative arms are declared, never inferred.** Marking as negative an arm that today exits 0 is a breaking change (§4.4.8). Submit's `nothing` stays a success, as `submitDelivered` says (`protocol/submitReceipt.ts:22`). Only `refused` is negative for `submit_work`, and `refuses: true` for `check_rules` keeps its own `CHECK_EXIT` codes as declared negative arms. The outcome travels on the wire (§4.4.5), so a client that does not know an arm still exits correctly.
- **The voice is a rendering.** `voice(answer, call) → text` gives model text for the native tool and MCP's `text`, replacing `GRAPH_VOICE`, `THREAD_VOICE` and `COMMAND_VOICE` (`nativeTools.ts:48-62`). The default is the answer's JSON. The voice never changes the structured value, and it must fit the tool-output envelope (§4.4.10).

### 4.4.2 The call's services

`invocation` builds each call from shared lifetimes and per-call facts. **A shared lifetime holds only what is the same for every caller of it.**

| Scope | Owner | Holds | Built |
|---|---|---|---|
| installation | a lifetime: each owner contributes its installation-lifetime services (providers' accounts, executions' host client, performance's recorder); installation owns only its own ([[f658e190]]) | machine store, settings registry, accounts, host clients, performance | once at boot |
| workspace | `workspace`, with `graph`'s serving | the served checkout's identity and its owner services: project ref, served graph of that checkout (store, tree, sync driver, freshness gate), vocabulary | per served checkout; cached with the serving entry, closed at eviction |
| run | `native-harness`, for a live native run called with its own grant ([[f658e190]]) | a **live** native run: thread actor, run id, world, scratch root, delivered-tags ledger, the run's authority policy, change-record port for that thread | per run; an adopted CLI session has the same lifetime, built by `external-harnesses` |
| call | `invocation` | call key and call id, deadline, door, origin, span, **lens** (scope, name reach), **working origin**, **file reach**, **provenance**, the prepared value and its **verdict** | per call |

- **Per call, never shared** (Astra S4-3):
  - The lens is resolved from the request and the actor: scope from `?scope`/`cwd`, and name reach `every-served-project` for the operator, `law-and-reflections` otherwise (`http/caller.ts:345-367`).
  - The working origin comes from `(actor, root)` (`WorkingOrigins.of`, `:419-425`).
  - The file reach is the thread's scratch, or the operator's proven root.
  - The verdict belongs to one prepared call (§4.4.3a).
  - The workspace lifetime's services take these as arguments from the call lifetime. None of them is captured when the workspace lifetime is cached.
- **Provenance is not a run.**
  - An act header names `{thread, run, step}` and is checked to belong to the thread. That is provenance, recorded on the act (`ThreadBornOf`).
  - It becomes a **run lifetime** only when that run is live **and** the credential is the run's own grant; the native door always has one.
  - A command that outlived its run keeps its provenance and its thread actor, reads and acts as that thread, and gets no run lifetime.
  - An operation declaring `run` refuses it `run-required`.
- **Needs.** A body's `R` must be assignable to `LifetimeServices<'installation' | 'call' | declared lifetimes>`, including through the erased table, because its element type carries the declared lifetimes. `Bound<…, R>` with a caller-chosen `R` (`perform.ts:61`) goes away. A body that uses a run service without declaring `run` fails to compile.
- **No ambient optionals.** A required service is a required dependency, never a `Context.Reference` with a sentinel default, whether `undefined` (`TreeCommits`) or `null` (`CurrentGraph`, `ServedGraphs`, `SignedCall`). The call key and the served graph become required services of the call and workspace lifetimes. `Context.Reference` remains for pure configuration values only. §4.4.11's rule checks this by the default's type, not by one sentinel.
- **Admission.** The door hands `invocation` a `Credential`:
  - a grant plus an optional act header;
  - a harness session token plus an optional shell key;
  - an MCP session token;
  - or `operator`.

  It also hands the **callback origin** (section 3 §3.4: the `tagma mcp-serve` session, the hook environment, the harness CLI), so `reentrant` is judged for every door and every feed.

  `invocation` resolves the credential through the owners, never tables:
  - grant → thread: `thread-record`;
  - act header → run and its state: `native-harness` — provenance always, a run lifetime only for a live run and its own grant, an ended run's command keeping its provenance and thread actor;
  - session token or shell key → adopted session, or an external principal (session and project, no thread): `external-harnesses`;
  - project: `projects`; lens and served graph: `graph`;
  - origin: `workspace` ([[f658e190]]).

  `invocation` is above all of them, so no port is needed. `http/caller.ts`'s reads move to those owners (F036).
- **Missing lifetime.** Before `prepare`, a call refuses:
  - `project-required` or `not-served` without a workspace;
  - `run-required` without a live run;
  - `thread-required` where `audience: 'thread'` meets another actor.

  A body never sees a half-built lifetime. For F001, `sync_graph` declares `workspace`, whose sync driver (E2 replaces `TreeCommits`, section 3 §3.9) is a required service of that lifetime.
- **`ThreadExecution` (F038).** `native-harness` declares the port, with the `afterEdit` ingress for standalone world tools, and `invocation` implements it (section 1 §1.4, [[f658e190]]):
  - `tools(run, ids) → ToolCatalog`
  - `execute(run, id, input, toolCall) → Outcome`

  `ThreadContext.owners` and `nativeOwners` dissolve into lifetime contributions. `nativeTools.ts` becomes the native door inside `invocation`.

### 4.4.2a Deadlines, derived from section 3 §3.12

A call's deadline is the cap on the **whole call**. Every wait inside it keeps its own §3.12 ceiling, and every wait draws on the call's deadline.

**The default is a sum, not a figure (Opus).** An operation declares the §3.12 waits it may enter (`waits`). Its deadline is the sum of their ceilings, capped at 15 min. For example, an ordinary graph act waits on:
- an execution ticket (60 s);
- the tree permit (60 s);
- its first unit's start (60 s);
- the running unit (60 s);
- a cold graph open (60 s, answered with `graph-opening` rather than cut).

That gives 5 min. A plain read waits on a reader pool under the read deadline, plus a ticket. `invocation` never cuts a call below the sum of the waits it declared. A wait entered but not declared is a defect counted by resource, and the `held-resources` rule (section 3) sees it. The kinds below are for the calls whose bound is not a sum of resource waits.

| Kind | Whole-call deadline | Derived from §3.12 | Operations (known today; K0 declares each) |
|---|---|---|---|
| sum (default) | Σ declared waits, ≤ 15 min | the table's rows for each wait | every read and act not listed below |
| `large` | the sum with a `large` unit's 10 min in place of 60 s | a `large` unit | `vacuum_database`, `apply_batch` over its size threshold, `repair_thread_rollout` |
| `pass-wait` | 60 s, then the current state and the pass still running (an answer, never `stalled`) | "an explicit wait for a pass" | `sync_graph`, `run_doctor`, `run_doctor_all`, `read_performance`, `read_findings` when it waits |
| `wait(input)` | the input's wait plus 60 s; the input is bounded in its schema by `LONGEST_ACT_MS` (10 min, claim 0df44c8c) | an explicit caller wait | `wait_terminal` (`waitMs`), `read_output` (`wait`), `read_terminal_bytes` with a wait |
| `landing` | 15 min | "a landing, admission to answer" | `submit_work`; `check_rules` (`over: change` and `staged` build and judge as a landing does); `checkout_commit` (runs the commit hooks); `merge_worktree` on its executing road |
| `inspection` | 15 min, each ask at T_ask ≤ 120 s | the inspection ceilings | `enforce_rule` (its prepare measures the reach), `check_rules` `over: all` |
| `program` | 15 min | the program default | `prepare_sandbox`, `prepare_worktree`, `create_worktree` (setup), `build_prepared_tree`, `update_worktree`, `reconcile_worktree` |
| `external` | 15 min, each step at its declared deadline | host verbs, network, git | `checkout_push`, `checkout_fetch`, `checkout_pull`, `start_terminal` and host-verb acts, `import_output`, `capture_performance_profile` (its duration input, bounded) |
| `model` | 30 min | a model request | `generate_thread_title` |
| `operator-wait` | the input's wait, bounded at 15 min | the absolute cap | `wait_command` — unbounded today (claim 0df44c8c). The operator's word ("never wait 3 hours") makes it bounded; a longer watch is the socket's `commands.subscribe` feed. |

- **`merge_worktree` keeps section 3's roads** (S4-10), and no amendment to section 3 is needed.
  - Try-admit on a free base runs the merge within the call and answers `merged`. It builds, judges and runs hooks as a landing does, so it takes the `landing` deadline, which is §3.12's landing row.
  - With `whenBaseFree` and a busy base, it answers `WorktreeMergeQueued` at once (`operations/worktrees.ts:503-530`, `working/PendingMerges.ts:57-91`), and the merge runs later as a pass.
  - Without `whenBaseFree`, a busy base refuses `base-merging`, as section 3 keeps it.
- A door's own timeout is honoured only downward: `Tagma-Deadline` over HTTP, the kernel's tool timeout.
- A call past its deadline answers `stalled` with the outcome its owner can prove (section 3).

### 4.4.3 Doors are projections

A door does four things:
- decodes transport into `(Credential, origin, id, input, call key, deadline, lens)`;
- obtains a verdict where it can (§4.4.3a);
- calls `invocation.run`;
- encodes and renders the outcome.

| Door | May add | Must not |
|---|---|---|
| **Native tool** | tool framing; the permission prompt from `confirmation`/`subjects`/`reads`; the voice; `settle` after a lost turn; the journal range for a block answer (`nativeTools.ts:219-226`) | decode its own input, reshape the answer, turn a refusal into `ToolFailed` |
| **HTTP** | `POST /api/op/<id>` typed per id (generated, §4.4.4); status by class (§4.4.5); `Tagma-Call`, `Tagma-Deadline`, `Tagma-Outcome`, `Tagma-Contract`; the lens query where the operation takes one (rule ecd6355b) | per-route renames or defaults, merged endpoints, a second body |
| **Socket** | feeds (§4.4.4); request verbs. Act verbs (`thread.send/queue/steer/answer/compact/continue/stop/model/authority`) are operations with `doors.socket` and carry a `callKey` field in their frame | call owners directly for an act |
| **CLI** | `tagma op <id>`; named verbs as declared aliases (`cli: {verb, args → input, render}`); CLI-only commands of their module (serve, setup, sign-in, hooks, mcp-serve — setup → installation, sign-in → providers, hooks → external-harnesses; the verb contract is platform's, section 1 §1.6.3); text and exit codes by class | its own vocabulary for an operation |
| **MCP** | `catalog` or `proxy` shape; annotations from `effect`/`intent`; the voice as `text`; `structuredContent` = the answer; `outputSchema` from `arms` (open) | a list of its own |

**Parity.** For every operation `o`, every pair of doors offering it, and the same credential, **the same verdict**, the same input and the same state:

1. The same outcome class.
2. On an answer, equal values after `o.answer`'s codec, the native value taken before its voice. Fields the state produces anew (ids, times) are compared under the case's controlled clock and id source, or by their declared shape (§4.4.11).
3. On a refusal, the same `code`, `unblock` and `inputFile`. `reason` is text and is not compared (f0530b87).
4. The same resolved actor, project, workspace root, run and provenance.
5. The same journal effects keyed by the call key.

Byte identity is not the criterion. Renderings (CLI text, voice, app view models) may differ, because each renders the one answer (open question 4).

**Feeds.** Subscriptions, byte streams, screen and grid feeds, and terminal input writes are feeds: owner-declared with event schema and refusals, admitted through the same admission (actor and origin), and not operations. View-lane keystrokes stay off the operation door (claim 5b495b46).

### 4.4.3a Permission verdicts at every door

One protocol, whatever the door:
1. `prepare` resolves what the act is about.
2. The subjects (`subjects(input, prepared, actor)`) and `reads(input, callerFiles)` are judged.
3. The **verdict** is bound to `(call key, digest of the prepared value)`.
4. `execute` runs with that prepared value.

The verdict lives in the call lifetime and is never reused by another call (`terminalAsk.askedOver` compares the exact subjects, `terminals/terminalAsk.ts:50-53`).

| Door and actor | How the verdict is obtained |
|---|---|
| native, thread | the kernel's permission door: the run's mode and rules, else asking the operator; the verdict is `asked(subjects)` or `ruled(subjects)` |
| HTTP, CLI, MCP, socket, **thread** credential | the thread's standing authority rules only, applied by the same judge without asking. A subject those rules do not allow refuses `approval-required`, with `unblock` naming the tool door that can ask and the operator's own door. A credential is never an approval. |
| any door, **operator** | `self`, as today |
| adopted CLI session — an external session (a Tagma thread) | its harness's own approval has already happened outside Tagma; Tagma applies that thread's rules as above and never widens them |
| **external principal without a Tagma thread**, resolved by external-harnesses ([[f658e190]]; the actor arm is `Actor.session` (section 5): session and project only, `protocol/caller.ts:20-24`) | it has no thread rules. Its policy is the operator's standing permission rules (`PermissionRules`, kept per credential owner, `harness/PermissionRules.ts:18-27`, served by the `grants` group). No per-harness grant exists today; adding one is a later decision. A subject no grant allows refuses `approval-required`, and an operation with no subjects and no reads proceeds. It is never treated as the operator, never given a run lifetime, and its own client's approval is never taken as Tagma's verdict (S4-4). |

- **What approval covers.** An approval covers the prepared value it saw. If execute finds the target moved (an owner's own check), it refuses, and a new call is judged anew.
- **Expiry.** Approval does not outlive its call. An asked verdict is dropped when the call ends, and a lost turn's `settle` never re-executes.
- **Parity cases fix the verdict source.** A native asked approval and an HTTP rules-only verdict are legitimately different inputs to parity, never a parity failure.

### 4.4.4 Catalog derivation from manifests

```ts
manifest({
  operations: [pair(readBlock, readBlockBody), …],
  feeds:      [feed('graph.subscribe', …)],
  endpoints:  [endpoint('auth.callback', …)],
  settings:   [commentPolicy, …],
  capabilities: [capability('terminals', { tools: [...ids] })],
  lifetimes:     { installation?: Layer, workspace?: Layer, run?: Layer },
});
// <module>/cli.ts: small, imported eagerly by the CLI entry
cli({ verbs: [{ verb: 'terminal', source: () => import('./cli/terminal.js') }] });
```

**Amended by [[f658e190]]:** manifests also carry `sections` (doctrine), `tables`, and the contributions of section 1 §1.4.4: hook entries, providers, agent library entries, resource kinds, gauges; `capabilities` are registered with `native-harness` and carry operation ids, standalone tool factories, runtime rules, prompt and context parts and availability per world; an implementation needing services is start-bound.

| Derived | From | Checked by |
|---|---|---|
| `OperationId` literal union, `OPERATIONS` | the union of `operations` over `MANIFESTS` (a typed tuple in `composition`) | `UniqueIds` by type and at boot; `pair` types each pair; the **inventory** (§4.4.11) proves every declaration and body is registered |
| HTTP binding | `doors.http` → `POST /api/op/<id>` | total by construction; `HTTP_OPERATIONS` removed |
| catalog read | every declaration's wire part → `read_operations` (paged, family `OPERATIONS`), which answers ids, meanings, input and answer schemas, `effect`, `intent`, `identity`, `negative`, `doors`, `audience` and tombstones | used by `tagma op`, `mcp-serve` and the app (§4.4.8) |
| MCP catalog, socket RPC group | `doors.mcp`/`audience`; `feeds` + `doors.socket` | `SERVED` removed; `socket/rpc.ts` generated |
| `VERB_SOURCE` | the modules' `cli.ts` | duplicate verbs fail by type |
| `CAPABILITY_IDS` | `capabilities` | agent files validate against the derived set |
| `SETTING_KEYS` | `settings`, passed to `settings` as the vocabulary argument (section 2 §2.4.9) | duplicate keys fail by type |
| server `exports` | subpath patterns, one per module: `"./<module>/wire/*": "./src/<module>/contract/wire/*.ts"` (rule 8183e6ef) | a new operation adds no line |

1. **`OperationId`** in `platform` is a branded string. The literal union is derived in `composition`, and a module's typed callers use its own literals.
2. **What is not an operation:** subscriptions and byte streams, protocol-mandated shapes (OAuth, MCP JSON-RPC framing, the host wire), liveness and succession (claim 00d00af4), and static assets. Each is admitted through the same admission when it has a caller. App-specific composed reads (a thread snapshot, locate, findings by doctor) are operations with `audience: 'operator'`, `doors: {http}` (Astra §6.4).
3. **The 94 unbound HTTP routes** are sorted in each module's wave into operation, feed or endpoint.

### 4.4.5 Answers, refusals, unsettled calls and defects: one shape per class

| Class | Meaning | Body | HTTP | Native / MCP | Socket | CLI exit |
|---|---|---|---|---|---|---|
| **answer** | the operation's word, including typed partial outcomes (`unpublished`, `conflicted`, `tail: pending`) | the `answer` value; `Tagma-Outcome: answer` or `negative` | 200 | result / `structuredContent` | success | 0; 1 on a negative arm, or the arm's declared code |
| **refusal** | nothing took effect | `{status:'refused', code, reason, unblock[≥1], inputFile?}` | 409 | result (not an error) / `isError: true` | error | 2 |
| **unsettled** | an admitted call crossed its deadline; effect `none` or `uncertain` (section 3) | `{status:'stalled', resource, holder, waited, outcome, key?, callKey}`; `Tagma-Outcome: stalled` | **409** | result / `isError: true` | error | 3 |
| **defect** | a server bug: `lock-order`, an unmapped failure, a die | `{status:'defect', code:'server-fault', reason, trace, unblock}` | 500 | tool error with the trace / `isError: true` | error | 70 |
| **connection** | client-side only: the transport ended before an outcome | never sent by the server | — | — | — | 4 |

- **Unsettled is 409, not 503.** Proxies and HTTP clients retry 503 on their own, and a blind retry of a write is exactly what must not happen. The body's `status` and `Tagma-Outcome` tell unsettled from refused. The generated client, `tagma op` and the MCP bridge **never retry any class automatically**. A retry is an explicit act with the same key (§4.4.6).
- **Refusals are one shape.** `not-found` is 409; the 404 `missingSchema` is retired. A native prepare-time refusal is a refusal result.
- **Door-level codes** are added to every operation's refusal type: `busy`, `reentrant`, `git-too-old`, `mcp-connecting`, `permission-denied`, `approval-required`, `field-invalid`, `project-required`, `not-served`, `run-required`, `thread-required`, `operation-retired`, `answer-retired`, `input-too-large`, `call-key-conflict`, `act-id-reused` (every `{key}` write), `stale-revision` (every `revision` write), and `rule-violated`/`inspection-failed` wherever a trigger applies (closing claim 34501c09's limitation).
- **Defects are named.** A `StoreFailure` the owner did not type is a defect, as today.
- **Connection loss.** The client holds its key. It re-sends only for a `{key}` identity. After a `revision` write it re-reads before any new write. After a `manual` write it reads the declared `settle` view. The app's `Refusal{code:'transport'}` (`Door.ts:22`) becomes this class.

### 4.4.6 Write identity and retries

Every `write` or `external` operation declares one of three identities:

1. **`{key}`: retry-safe by key.** The owner's durable record of the act is keyed by the **call key**. A repeat answers the recorded outcome without running the body; the same key with a different request digest refuses `act-id-reused`.
   - **The key is the caller's own when given, else the door's call id.** A caller-chosen key survives a model retrying through a new tool call, which a door's id cannot. The terminal, command and worktree inputs' `operationId` field becomes `requestKey`, through `renamed: {from: 'operationId'}` for one release (`protocol/operations/terminals.ts:13-15`; section 5); it renames the field, not its value set. Other operations whose repeat by a model is costly declare an optional `requestKey` input field. Absent a field, the key is the door's call id.
   - Records today or decided:
     - `graph_act` (section 2);
     - the `landing` job (section 3);
     - `terminal_operation` and command acts (`operationId`);
     - worktree and thread-target intents;
     - **spawn**: the child's inbox receipt, inside section 2's C2 birth unit, answering `spawn-conflict` on another request (`HarnessBirths.ts:119-149`);
     - **`send_message` and `send_task`**: the envelope, which today gets a random UUID (`ThreadEnvelopes.ts:848`), so a door's re-delivery never makes a second message. A model that sends again under a new tool call without `requestKey` sends a second message, which is visible and cheap.
   - **The physical key encodes the whole canonical key (S4-2).** `thread_inbox.id` is its own primary key (`db/thread.ts:320-339`), and spawn looks its receipt up globally, so an id that drops the actor or the operation lets two callers collide. The inbox owner therefore writes `envelope:<operation>:<actor>:<key>`, e.g. `envelope:spawn:<parent thread>:<key>`, with each part escaped. Receipts written before the change stay readable: for one release, spawn's lookup tries the new id and then the legacy `envelope:spawn:<requestId>`. Legacy ids were tool call ids, unique by construction, so a legacy hit cannot belong to another actor.
2. **`revision`: guarded, never blindly retried.** The input carries the revision the caller read, and the owner compares-and-sets it. A retry after anyone's intervening write, the caller's own included, refuses `stale-revision` with the current value, so a lost answer is resolved by reading and never by overwriting another writer (Astra S4-1). This is the road for setters: `write_setting`, `write_setting_layer` (section 2's applied revision for catalogs), `set_thread_delegation`, model selection.
   - **The revision field is optional for one release (Opus).** A new required field is breaking (§4.4.8). A call without it runs as `manual` with its `settle` read for that release. The release after, the field is required, and the snapshot records the change as a bridged break.
3. **`manual`: not retry-safe.** Allowed only with a declared `settle` read. Nothing retries it automatically; after a connection loss the client reads `settle`. **Settle proves what it can and says so (S4-1).** The current state alone does not prove an earlier act: A archives T and loses the answer, B restores T, and the settle read sees "not archived". So `settle(callKey)` answers one of:
   - `happened`: evidence of **this** act, keyed by the call key: a journal or event row, or a record the owner keeps;
   - `not-happened`: proof by order, the way section 3 proves `abandoned`;
   - `unknown` with the current state: the current state is known, the earlier outcome is not.

   Archive, pin and move (`operations/session.ts:374-391,439-452`) answer `unknown` until their owner records the act under its call key; they need not, because the state they set is visible and re-settable by a person.

A write with none of the three does not compile. "A repeat answers the recorded outcome" is promised only for `{key}` (§4.10 q16).

**Canonical call key.** A call key is `{actorRef, operation, key}`, where the actor ref is the resolved caller's stable identity, never the whole `Actor` with its reach and act: thread id, external session (the same arm, [[f658e190]]), or operator installation. The owner's record stores the actor ref, the operation, the key and the **request digest**: the canonical JSON of the decoded input **with its key-carrying fields removed** (`operationId`, `requestKey`, and any field the declaration marks `role: 'key'`), plus the target scope. Every door normalizes the same way, so a first call keyed by the door's id and a retry naming the same key in `requestKey`, or moving it between header, metadata and field, have one digest and never meet a false `act-id-reused` (S4-2). The same key under another actor or another operation is a different act. Provider tool ids, UUIDv7s and caller keys all live in this one space, qualified by actor and operation (Astra S4-2). The journal keeps its session-qualified `callId` lookup (`Journal.ts:262-270`, claim 36cfb518) with this key.

| Door | Carrier of the key | Recovery after connection loss |
|---|---|---|
| native | input key field, else the tool call id | the kernel's `settle` after a lost turn |
| HTTP | input key field, else `Tagma-Call`; both present and different → `call-key-conflict` | re-send with the same `Tagma-Call` or field |
| CLI | `tagma op --key <k>`; else minted and **printed on stderr with every non-answer class**, so a rerun can pass it | rerun with `--key` |
| MCP | the operation's input key field (the model chooses it); else MCP request `_meta["tagma/key"]` when the client sends one; else the bridge mints per request | a client that sent no key cannot re-address the act. The operation's `settle` read or its `{key}` input field is the road; stated as a limitation of MCP clients |
| socket | `callKey` in the verb's frame (the app mints it per gesture and keeps it across reconnect) | re-send the frame |

### 4.4.7 Browser safety, the generated client, and one intent per gesture

- The app imports only `contract/wire` (section 1 rule 1). Bodies, voices, lifetime layers, manifests and parity cases are server-only or test-only.
- **Generated client.** `api.op.<id>(input)` over the generated `Api`, decoding answers through `arms` with its fallback. The 20 hand-mirrored types are deleted, and a repository uses `typeof decl.input.Type`. Hand code remains only for view models.
- **One gesture, one operation (F041).** `set_thread_model` in `native-harness` ([[f658e190]]) takes `{thread?, provider, model, account, reasoning, switches, remember: boolean, defaultAccount?: string}`. It writes in **one** machine unit — C1 inside `native-harness` over `thread`'s selection and its model-defaults table; when `defaultAccount` is named, C2 with providers' default-account table under its own revision:
  - the thread's selection in `thread`;
  - with `remember`, the owner's model defaults in native-harness's model-defaults table (cut from `thread_owner_settings`), and a named `defaultAccount` in providers' default-account table.
  - **Covering compare-and-sets.** The call carries the revision of the thread's selection, and with `remember` also that of the owner's defaults. Both are checked in the unit. Every writer of either row bumps its revision in the unit that writes it, including the road without `remember` and `ThreadAggregate.setModelSettings`'s other callers, so no writer slips past the check.
  - **The thread's account never moves the default.** The thread gets `account`. The defaults write keeps today's `account: null` (`HarnessHost.svelte.ts:1311-1322`, `ThreadOwnerSettingsStore.ts:163-166`), so the default account is unchanged unless the call names `defaultAccount` as its own explicit intent.
  - **Without a thread** (a draft), only the defaults are written, as `HarnessHost.svelte.ts:1321-1331` does, with only their revision.
  - The thread's snapshot and rollout publication run **after** the commit, never inside the unit.
  - Its identity is `revision` over both rows.

  Where two writes are independent intents, each shows its own outcome.
- `package-boundary`'s browser-safety check covers every `contract/wire` the app reaches (F077 stands).

### 4.4.8 Versioning and compatibility

The parties:
- the server;
- the app, served by it from the same origin, but a loaded page outlives an upgrade;
- the CLI, the same binary but possibly another build than the running server;
- the MCP bridge and the clients above it, which cache tool lists;
- running threads (per-turn tool catalogs, frozen instruction text, and a model that remembers calls).

The execution host is section 2 §2.4.10's.

1. **Compatible:**
   - a new operation;
   - a new optional input field;
   - a new answer field;
   - a new answer arm that is not negative, or whose outcome the server sends (`Tagma-Outcome`);
   - a new refusal code;
   - a new door;
   - text.
2. **Breaking:**
   - a renamed id or field;
   - a removed or narrowed field;
   - a new required field;
   - a changed meaning of a field or arm;
   - an arm newly marked negative;
   - a narrowed `audience` or `doors`;
   - a changed `identity` or `lifetimes`;
   - a lowered `deadline` kind.

   A breaking change declares `replaces: {id, adapt}` or `renamed: {from}`. The old spelling is accepted for **one release** through the adapter, and its answer is mapped back where it differs. After that the old id is a **tombstone** for the installation's life, refusing `operation-retired` with the replacement in `unblock`.

   **A breaking answer under the same id and input is chosen by the caller (S4-5/S4-6).** `replaces` and `renamed` bridge only a distinguishable old spelling. When one request must be answered in two shapes during the overlap, the declaration carries `answers: {1: adapt, 2: current}`, and the request names the version it reads:
   - `Tagma-Answer: <n>` over HTTP;
   - `--answer <n>` on the CLI, which generated verbs set to the version they were built with;
   - `_meta["tagma/answer"]` for MCP;
   - a frame field on the socket.

   The native door always reads the current version, because its catalog is per turn. During the overlap, a request naming no version gets the **oldest** version still carried, so unwritten clients keep their shape; after it, the current. A version no longer carried refuses `answer-retired`, naming the current one. The same bridge carries a field that turns required (the `revision` fields of §4.4.6) and an arm newly marked negative. The machinery ships in **K5a**, before the first breaking change (K4).
3. **The contract snapshot per module** (`<module>/contract/wire/contract.snapshot.json`, regenerated by script, no text) records per operation:
   - id, doors, audience;
   - effect, identity, deadline kind, lifetimes, subject;
   - negative arms, page family and bounds;
   - input and answer JSON Schemas, refusal codes;
   - whether a permission face is present.

   The check refuses a diff it classifies as breaking without `replaces`/`renamed`.
   - **Limits, stated:** the snapshot sees structure and declared metadata. It cannot see a changed meaning under an unchanged shape. That case requires the owner to declare `breaking: <why>` with the bridge, and review judges it; no check claims to classify it.
4. **Clients read the server's catalog, not their own.**
   - `tagma op` resolves ids, destructive intent, identity and negative arms from `read_operations` (cached per server build), not from its compiled `OPERATIONS` (`op.ts:44-50,143-166`).
   - `mcp-serve` builds its tool list and routing from it (`mcpTools.ts`), and on reconnect with a moved digest emits `notifications/tools/list_changed`.
   - Named CLI verbs map their arguments locally and send. The server decodes. A stale mapping meets `field-invalid`, never a build check, so **installed commit hooks (`check`) are never blocked by skew** (`commitHooks.ts:41,50,70`). No `contract-skew` refusal exists.
   - The server sends `Tagma-Contract: <build>` on every HTTP response and in the socket hello. The app, on another build, persists drafts and reloads when idle.
5. **MCP `outputSchema`** is generated from `arms` with its open fallback and `additionalProperties` open, so a cached older schema still validates an additive answer. A breaking change is aliased for the release, and `list_changed` refreshes the cache.
6. **Running threads** meet new schemas at their next turn. A remembered old call meets the alias inside the release, or `operation-retired` naming the replacement. The delivery reports the retired ids a thread's frozen text mentions, and `refresh_thread_instructions` corrects the text.
7. **Minimum range, stated honestly.** Clients built before K5a (§4.9) cannot learn the catalog from the server and do not read `Tagma-Contract`. Nothing can teach an already-loaded page or an installed older CLI after the fact. So:
   - K5a ships first.
   - No typed route retires until the release **after** the one where the app and CLI reached it through `/api/op` and read the catalog from the server.
   - Retired routes answer 410 with `operation-retired`'s body for one more release.

   Clients from before K5a are supported only against a server of their own build, which today's same-binary install and the app served from the same origin already give. An open page older than K5a is covered by the one-release overlap and a manual reload.

### 4.4.9 `check_rules`: one operation, owned by `enforcement`

*Amended by section 1 v10 ([[f658e190]]): the placement in `worktrees` this subsection decided is withdrawn.*

- **Decision.** **`check_rules`: one operation, owned by `enforcement`, no port.** `change` asks change-record for the session's prepared change (the same implementation `submit_work` uses; the caller's git runner is an argument where it must run as the thread's command); `staged` reads the root's index through workspace; `all` judges HEAD. The retained judgement, set paging and full-result verdict of §4.4.10 stay, on enforcement's shelf. The answer and refusals stay, except the bounds of §4.4.10.
- **`ChangeSubjects` goes.** `record_commit` stays in `enforcement`.
- **Rejected: `check_rules` in `worktrees` or `landing`** — it made landing own a question of law.
- **Native tools** ([[f658e190]]). Standalone native tools (files, shell, web) are not operations; their edits reach triggers through `ThreadExecution.afterEdit`. They keep today's boundaries: the World decides access, paths outside the root are allowed, attribution happens only in a shared tree, `.tagma` is never a thread's work, an isolated world runs as nobody, and grant, run and step are never inherited by accident (`worldTools.ts:13-34,44-55`); a thread's frozen agent view comes from its saved bytes and profile (`agents/library.ts:254-288`), never from today's contributions.
- **Rejected: two operations.** It would rename a delivered agent contract and `submit_work`'s grammar, and split one question, for no boundary gain.

### 4.4.10 Paging and bounded answers

Rule 68659e3b covers rows. Every other variable field is bounded too (Astra S4-8).

- **Rows.** `page: FAMILY` derives `limit`, `cursor`, `total`, `shown` and `next`. The door prints the continuation call from `next`.
- **Every other variable field is declared in `bounds`,** with one of three shapes:
  - **capped list:** at most N items, plus `…Total`, derived like a page ceiling from the envelope divided by a measured item;
  - **summary plus address:** counts and a digest in the answer, and the full set read through a declared paged operation;
  - **retained result:** the full JSON kept under the output shelf (section 2 §2.4.11) and answered as `{ref, bytes}`, read by `read_output`-style paging.

  An operation with an unbounded field does not compile once K0's debt is paid.
- **`check_rules`, concretely (S4-8).**
  - **The judgement is retained.** Its full result — violations, fingerprints, rules, unjudged, paths — is kept on the output shelf (section 2 §2.4.11), keyed by its selection: over, head, built tree, root, index, rules or inspection. A continuation reads that retained result and **never re-judges or reads another set** (`read_changes` is an authorship journal, not a snapshot of the judged tree, `operations/session.ts:604-647`).
  - **Every set pages from it:** `set: 'violations' | 'fingerprints' | 'rules' | 'unjudged' | 'paths'` with `limit` and `cursor`, each set's cursor bound to the retained result's key. A moved HEAD or change refuses the cursor `cursor-stale`, as today. The first page carries each set capped, with its total.
  - **The verdict is computed over the full result** before any cap and sent whole: `verdict: {refuses, gatedRefusing, unjudgedAtGate, counts}`. The CLI and hook verdicts (`cli/commands/check.ts:62-68,107-120`) read `verdict` and never the capped arrays. They move in the same change as the new answer, so a truncated `rules` or `unjudged` can never yield a false `clean`.
  - This is a **breaking** change of `check_rules`'s answer. It is bridged by answer version (§4.4.8(2)): version 1 answers the full arrays as today during the overlap, and version 2 answers the capped sets, the verdict and the retained pages. The CLI built with K4 asks for version 2.
- **Two envelopes.** The **voice** must fit the tool-output envelope and may summarize, naming the read that continues. The **typed JSON** is bounded by `page` and `bounds`, never truncated by a door. A JSON answer over its declared bounds is a defect of that operation's bounds, counted and named. An operation with no page or bounds is never blamed on a family.
- **Input.** The HTTP door refuses a body over the call's admission charge (section 3 Capacity; 16 MiB by default) with `input-too-large`. Documents travel by path.

### 4.4.11 How it is held

- **Compiler:**
  - the manifests' union;
  - `pair` typing;
  - `UniqueIds`;
  - `R ⊆ LifetimeServices<lifetimes>`;
  - `execute`'s value assignable to `answer`;
  - a write identity for every write;
  - `bounds` for every variable field (after the debt).
- **Module inventory (Astra S4-7).** `pair` proves a registered pair right, not that everything is registered. The `operations-registered` rule reads each module's AST: every `operation(…)` in `contract/wire` and every `body(…)` must be referenced by that module's manifest, and every manifest pair's declaration must be exported from `contract/wire`. An unregistered declaration or body refuses at gate. This restores today's independent totality (`operations/index.ts:45`) without a central list.
- **Rules at gate:**
  - `modules` entries (section 1): the app → `contract/wire`; doors → `invocation`'s `contract/service`; bodies imported only by their own manifest;
  - `no-ambient-capability`: no `Context.Reference` whose value type is a service or a nullable service, whatever the sentinel; debt = today's instances (`TreeCommits`, `CurrentGraph`, `ServedGraphs`, `SignedCall`, and any others found), owned by K1;
  - `contract-snapshot` (§4.4.8(3));
  - `operations-registered`;
  - `answer-declared`, with first-run debt owned by K0.
- **Parity over the catalog.**
  - Cases are **test-only**, in `<module>/operations/*.cases.ts`, never in `contract/wire`.
  - A case is `{fixture, clock, ids, verdict, input, expected class, compare?}`. Produced values (ids, times) are either fixed by the case's clock and id source or compared by declared shape.
  - Every operation declares at least one refusal case (`field-invalid` is always available) and an answer case where a fixture exists. Unmeasured operations are listed by id, never counted as passing.
  - Doors are exercised **in process through their real framing** (HTTP handler, socket RPC handler, CLI command runner, MCP router) inside one integration file per module, within rule adb6798b's budget: one server start per file, no host or CLI process per case.
  - Per surface, two real-process tests are system tests (rule 99b9fa72).

## 4.5 Owners and boundaries

| What | Owner |
|---|---|
| declaration, body, voice, settle, cases, snapshot | its module |
| `operation()`, `arms()`, `pair()`, `feed()`, `endpoint()`, `manifest()`, failure classes, `OperationId` brand, `Credential`, call key | `platform` (types and constructors) |
| admission, identity resolution through owners, lifetime assembly, the verdict protocol, execution, triggers, deadlines, the native tool projection, `ThreadExecution` | `invocation` |
| lifetimes | installation → a lifetime owners contribute to, `installation` owning only its own; workspace → `workspace` with `graph`'s serving; run → `native-harness` (`external-harnesses` for adopted sessions); call → `invocation` |
| HTTP, socket and CLI framing | the doors (section 1 rule 5) |
| MCP framing | `cli`'s `mcp-serve`, from the server's `read_operations` |
| derivation, generated `Api`/RPC/verbs, `exports` patterns | `composition` |
| `check_rules` | `enforcement`, over change-record's prepared change |
| `set_thread_model` | `native-harness` |
| operation owners (section 1 v10, [[f658e190]]) | `read_changes`, `read_authorship`, `strip_comments` → change-record; `read_checkout`, `read_checkout_history`, `read_commit`, `read_repositories`, `checkout_*` → workspace; `submit_work`, `merge_worktree`, `check_worktree_merge`, `cancel_worktree_merge`, `open_worktree_pr` → landing; `create_worktree`, `prepare_worktree`, `adopt_worktree`, `abandon_worktree`, `reconcile_worktree`, `read_worktree_operation`, `prepare_worktree_recovery`, `list_worktrees`, `archive_worktree`, `restore_worktree`, `forget_worktree`, `delete_worktree`, `rename_worktree`, `clean_up_worktrees`, `list_archived_worktrees`, `list_worktree_cleanup` → worktrees; `read_settings`, `write_setting`, `write_setting_layer` → settings; `vacuum_database` → installation; `read_compaction_choices`, `refresh_thread_instructions`, `read_calls`, `control_call`, `set_thread_model`, `save_agent`, `read_thread_agent` and the workflow operations → native-harness; `read_harness_screen`, `speak_harness` and the session operations → external-harnesses; `list_threads`, `read_thread`, `read_thread_record`, `read_thread_rollout`, `repair_thread_rollout`, `answer_ask`, `cancel_ask`, `continue_thread`, `archive_thread`, `archive_threads`, `pin_thread`, `move_thread`, `delete_thread`, `set_thread_delegation`, `generate_thread_title`, `adopt_thread_title`, `read_agent_library`, `read_agent`, `update_worktree` and the collaboration operations → threads, dispatching through `Harness` where the thread's runtime or record answers; the MCP server operations now in `operations/projects.ts` → mcp; `check_rules` → enforcement. Paging of every set, the full-result `check_rules` verdict, prepared-value consent and F041 stand unchanged |

## 4.6 Rejected alternatives

- **Keep typed REST routes and test them for parity.** They are the drifting second vocabulary. Direct endpoints remain only for what is transport-bound.
- **Byte-identical answers as parity.** Forbids renderings and proves nothing a shared codec does not.
- **A generic call-outcome table in `invocation`.** It duplicates the owners' records. Owners key their own records by the canonical call key.
- **`natural` idempotency for setters.** An automatic retry after another writer undoes that writer (S4-1). Replaced by `revision`.
- **Deriving the key only from the door.** It loses retry safety when a model re-issues through a new tool call (B1). The caller's key comes first.
- **Treating a thread credential as consent.** A credential is not an approval of a specific prepared act (S4-4).
- **503 for `stalled`.** Invites automatic retries.
- **A `contract-skew` refusal on named verbs.** It would block agents' commits through installed hooks. Server-side decoding makes it unnecessary.
- **Versioned ids or an API version header.** One server serves one catalog; aliases, tombstones and server-read catalogs cover the actual clients.
- **`check_rules` in `worktrees` or `landing`** (§4.4.9, [[f658e190]]).
- **Two `check_rules` operations** (§4.4.9). **Socket streams as operations** (no single answer). **Late-bound owner locators** (section 1 rule 9).

## 4.7 Acceptance criteria

1. A new operation adds files only under its module. `composition`, the doors, `package.json` and every derived list change by zero lines.
2. The five filter lists, `HTTP_OPERATIONS` and `OPERATION_BODIES` are gone. `VERB_SOURCE`, `CAPABILITY_IDS` and `SETTING_KEYS` are derived.
3. Each of these fails to compile:
   - a body using an undeclared lifetime;
   - a duplicate id, verb, key or capability;
   - an `execute` value not assignable to `answer`;
   - a write without identity.

   `operations-registered` refuses an unregistered declaration or body.
4. The parity test covers every operation at every door it offers, in process, within the integration budget, and lists unmeasured operations by id.
5. `sync_graph` over HTTP in a team project answers as the native tool does, after the same freshness pass (task 37439dcf). On an unserved checkout it refuses `not-served` at every door.
6. No door imports a table, `db/*` or another door. `no-ambient-capability` has no debt.
7. A thread caller over HTTP with a live run's grant gets that run lifetime. A command that outlived its run gets its provenance and no run lifetime.
8. The same `operationId`, `requestKey` or `Tagma-Call` answers the recorded outcome for every `{key}` write, at every door. Its first run and its retry make one act. A different digest refuses `act-id-reused`. The same key under another actor or another operation is a different act, including two parents spawning with one `requestKey`. A retry that moves its key into `requestKey` or between carriers has the same digest. A legacy spawn receipt is still found for one release.
9. A `revision` setter retried after an intervening write refuses `stale-revision` and never overwrites. Without its revision field during the bridge release, it runs as `manual`. A `manual` settle answers `unknown` when a later write has hidden the act it asks about.
10. A thread credential over HTTP never executes a subject its rules do not allow: it gets `approval-required`. An external principal without a Tagma thread is judged by the operator's standing rules, or refused. The native door asks as today.
11. One shape per class. `not-found` is 409. `stalled` is 409 with `Tagma-Outcome: stalled`. No generated client retries automatically.
12. The whole-call deadlines follow §4.4.2a. `submit_work` with a hook taking 5 minutes lands. `wait_terminal` with `waitMs` of 10 min answers. `wait_command` is bounded.
13. An older `tagma op` and `mcp-serve` (built at or after K5a) call a newly added operation, and installed hooks keep judging commits across a server upgrade.
14. An answer over its declared bounds is counted as that operation's defect. `check_rules` version 2 with `limit: 1` answers within its bounds. Paging every set reads the retained result of the same judgement. Its `verdict` equals the verdict over the full result, including a case whose `rules` and `unjudged` exceed their caps. A client naming no version during the overlap gets version 1.
15. `set_thread_model` with `remember` changes both rows or neither. A concurrent writer of either row makes it refuse `stale-revision`. A thread account never moves the default account unless `defaultAccount` is named. The draft road writes defaults only. Publication follows the commit.
16. `merge_worktree` on a free base merges within the call under the landing deadline; with `whenBaseFree` and a busy base it answers queued; without it, a busy base refuses `base-merging`.
17. `check_rules` lives in `enforcement`, builds its change through change-record, and `ChangeSubjects` is gone ([[f658e190]]).
18. Every call's span is `op.<id>` with door, actor kind, class and call key (claim c701ba75).

## 4.8 Findings, claims and tasks

- **Answered here:**
  - F001 (K1, with the interim fix below);
  - F008 (its class ends with K2);
  - F034, F035, F036, F037;
  - F038 (`ThreadExecution`);
  - F041 (§4.4.7);
  - open question 4 (§4.4.3).

  F039 and F040 are section 1's.
- **Task 37439dcf** takes the interim fix now. The HTTP door, before the body:
  1. runs the same freshness step `delegate` runs today (`freshOnce(current)`, `GraphRouting.ts:188-195`), because `GraphPool.resolve` on a warm entry does not freshen (`GraphPool.ts:147-193`) and admission does not either (`http/caller.ts:310-328`);
  2. keeps the caller's and the machine's bindings;
  3. provides the served checkout's context around the **whole** body, as the native door does.

  K1 then removes the class.
- **Claims to rewrite from the code once built** (never re-tensed from this text):
  - 5b495b46, c0c913f5 (bindings generated);
  - d1443b8d (the seam carries scopes);
  - 36b70e58 (owners per scope);
  - 591ef364, e57cc374 (answer codec in the body);
  - 34501c09 (explicit subject; limitation closed);
  - b073a7a9 (triggers in `invocation`);
  - 00d00af4 (health as an endpoint with admission);
  - 0df44c8c (`wait_command` bounded);
  - 36cfb518 (journal lookup by call key).
- **Claims that stand:** 15d24292 (prepare/execute, now the verdict protocol at every door), a34a9113, 97b67e90, e3331ccd (a command outlives its run; now provenance).

## 4.9 Build order

Aligned with section 1's waves, section 2's D0–D9 and section 3's E0–E8.

1. **K0 (with D0/E0).**
   - The new declaration fields beside the old: `answer` via `arms`, `negative`, `effect`, `subject`, `identity`, `waits` and `deadline` kind, `page`, `bounds`, `lifetimes`, `doors`, `audience`.
   - Today's five lists derived from them, with no behaviour change.
   - `answer-declared` and `operations-registered` at gate, with first-run debt.
   - The failure classes and door-level codes in `platform`.
2. **K1 (with section 1's `invocation` wave and `native-harness`'s (`ThreadExecution`) and `threads`' (`Harness`) two-phase starts; needs D2's `graph_act` and E0's deadlines).**
   - One admission, including the origin; per-call lens, origin, file reach, provenance and verdict; shared lifetimes without caller facts.
   - The verdict protocol at every door.
   - Every door calls `invocation`.
   - Call keys and carriers at every door, including `requestKey`, the carrier-free request digest, and full-key envelope ids for spawn and send with the legacy spawn lookup.
   - `manual` settle reads with their `unknown` outcome.
   - The deadline table.
   - The unified refusal shape and HTTP status by class.
   - `no-ambient-capability` at gate.
3. **K5a (before any route retires).**
   - `read_operations`; `tagma op` and `mcp-serve` read the server's catalog.
   - `Tagma-Contract` and `Tagma-Outcome`.
   - The app's idle reload.
   - `arms` fallback in every generated decoder; MCP `outputSchema`, open.
   - The bridge machinery, before any breaking change:
     - aliases (`replaces`, `renamed`) and tombstones;
     - answer versions (`Tagma-Answer`, `--answer`, `_meta`), defaulting to the oldest version carried during an overlap;
     - optional-for-one-release fields.
4. **K2 (each module's wave).**
   - Generated `/api/op/<id>` endpoints and client.
   - The module's app repositories and CLI verbs move to them.
   - Its typed routes retire **one release after** its callers moved, answering 410 for one more.
   - Its unbound routes are sorted; its socket act verbs become operations.
   - Its answer and bounds debt is paid.
5. **K3 (with section 1's manifest step).** Manifests carry operations, feeds, endpoints, settings, capabilities, lifetimes and `cli.ts`; lists derived; `exports` patterns; the `OperationId` brand.
6. **K4 (`enforcement` wave, after change-record's prepared change, with E4; after K5a; [[f658e190]]).**
   - `check_rules` whole in enforcement.
   - Its retained judgement, set paging and full-result verdict.
   - Answer version 2, with version 1 carried for the overlap.
   - The CLI and hooks on `verdict`, in the same change.
   - `ChangeSubjects` removed.
7. **K5b.** Snapshots per module and the `contract-snapshot` rule.
8. **K6.** The catalog parity test with test-only cases; `set_thread_model` in native-harness.

## 4.10 The remaining questions of rule 8dab19b6

1–9 are §§4.1–4.9.

10. **Contract.** This section.
    - New shapes:
      - the declaration fields;
      - the `stalled` and `defect` bodies;
      - `Tagma-Call`, `Tagma-Deadline`, `Tagma-Outcome`, `Tagma-Contract`;
      - `requestKey`, `callKey`, `--key`;
      - `read_operations`;
      - the door-level codes of §4.4.5.
    - Compatibility is §4.4.8.
    - Every operation keeps its id and current fields, except these, each bridged by §4.4.8(2):
      - `check_rules`'s answer version 2;
      - the `revision` fields, optional for one release;
      - `wait_command`'s bound.
    - Typed HTTP routes are internal and retire as §4.4.8(7) says.
11. **Stored data.**
    - Owners' `{key}` records gain `actor_ref` and `request_digest` where they lack them. Inbox ids take the full-key form `envelope:<operation>:<actor>:<key>`. Old ids stay valid, and spawn's legacy lookup is carried for one release.
    - `revision` setters use the rows' existing revisions or gain one: the thread's model selection, owner settings and delegation, a column each, bumped by every writer of the row.
    - Retained results, `check_rules`'s judgement among them, use section 2's output shelf, keyed by their selection.
    - Rollback: the columns are additive, and tombstones and the catalog are derived.
12. **Who may do what.**
    - `audience` and admission decide reach.
    - The verdict protocol (§4.4.3a) decides consent per call, checked in `invocation` for every door.
    - If a check is wrong, the parity test's actor and verdict points, and the per-door metric by actor kind and verdict source, show it. The fix is in one declaration or one rule set.
13. **Long-lived things.**
    - Workspace lifetimes live with their serving entry and hold no caller facts.
    - Run lifetimes live with their live run.
    - A verdict lives for its call.
    - Aliases leave after one release; tombstones stay.
    - The per-caller tool cache (`builtByCaller`, `nativeTools.ts:143`) becomes a per-run catalog.
    - MCP sessions re-read the catalog on reconnect.
    - A catalog change racing an in-flight call ends typed, never hanging.
14. **Bounded resources.**
    - Rows by page, other fields by `bounds`, voice by the envelope, input by admission.
    - Lifetime services are built once per lifetime.
    - The catalog has about 160 operations; the MCP `proxy` shape serves clients that cannot afford the full list.
15. **Rollout.** §4.4.8(6–7): per-turn catalogs; aliases; server-read catalogs from K5a; the one-release overlap and 410 answers; the app's idle reload; hooks unaffected.
16. **Failures.**
    - A dropped connection: the key recovers `{key}` writes, a re-read resolves `revision` writes, and `settle` answers `manual` ones with `happened`, `not-happened` or an honest `unknown`.
    - A restart mid-call leaves the owner's keyed record, so a re-send answers it or runs once. **This is promised only for `{key}` writes.**
    - Concurrent calls with one key meet the owner's key: one runs, the other gets the outcome or `act-id-reused`.
    - A crash after the act and before encoding loses only the encoding.
17. **Observability.**
    - A span per call with door, actor kind, verdict source, class, refusal code and call key.
    - Counts by operation × door × class.
    - Retries per key.
    - `stale-revision` and `approval-required` counts.
    - Answers over bounds.
    - The parity test's unmeasured list.
    - Snapshot diffs.
    - `operation-retired` and 410 counts, which show when a window can close.

## 4.11 Amendment to section 1 — withdrawn

**Withdrawn; superseded by section 1 v10 ([[f658e190]]),** which places `check_rules` whole in `enforcement` over change-record's prepared change. The table below is kept as the record of what was proposed against section 1 v7 and is not applied.

| Where | Now says | Becomes |
|---|---|---|
| `spec-01-modules.md:25` (entities table, "Law" row) | enforcement owns rules, checks, debt, commit queue, **and the `ChangeSubjects` contract** | enforcement owns rules, checks, debt and the commit queue, and offers the judgement services `judgeTree`, `judgeStaged`, `judgeHead` in its `contract/service` |
| `:26` ("Work delivery" row) | `check_rules` over the change (a landing run without a commit) | **`check_rules` whole** (`change`, `staged`, `all`), calling enforcement's judgement services |
| `:79` (§1.5 map) | `check_rules` over the change → `worktrees` (port `ChangeSubjects`, declared by `enforcement`) | `check_rules` → `worktrees` whole; no port |
| `:87` (reverse edge `enforcement → worktrees`) | `check_rules` over the change — `worktrees` through the port `ChangeSubjects` | `check_rules` in `worktrees`; the edge is `worktrees → enforcement` (contract), and no reverse edge remains |
| `:136` (§1.8) | the choice handed to section 4 | "Decided in section 4 §4.4.9: the whole operation in `worktrees`, no port" |
| `module-map-v6.md:30` | only the `over=change` branch moves; staged/all stay in enforcement; `ChangeSubjects` declared by enforcement, implemented by worktrees | the whole `check_rules` body (`operations/enforcement.ts:138-276`, with `stagedCheck`, `changeSubject`, `handoverOf`, `landingPlace`) moves to `worktrees`; `record_commit` and the other enforcement operations stay |
| `module-map-v6.md:71` | the same, for the `enforcement→worktrees` edge | the edge resolves by moving the body; `worktrees → enforcement` is a contract edge |
| `module-map-v6.md:255` | `ChangeSubjects`: enforcement declares, worktrees implements and calls | row removed; the catalog-arguments half of the row stays |

The import measurement of appendix C is unchanged in kind: the body's imports of `enforcement` become the `worktrees → enforcement` contract edge that the map already counts, and no new edge or cycle appears.
