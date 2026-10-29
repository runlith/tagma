---
id: 01a0e45e-f948-7d24-a3e1-33975610ee2b
title: "Source review: agent-kernel boundaries, recovery and reliability gaps"
ord: 22
---
# Agent kernel architecture: evidence from the current implementation

This is a source review, not a runtime measurement or a verification stamp. The architects read the shared checkout while it stood at `5aa47d24bcbab2ccd0c9b0e523f361af7564d709`; unrelated work was present in `layer`, `query` and the app. No code, test, typecheck, database query, model request or load experiment was run. Line references name the files actually read; implementation must refresh them if the checkout moves.

## K1. The thread floor hides several independent owners

`packages/agent/src/boundary.direction.ts:13–24` places storage, agent definitions, compaction, cache, evidence and the aggregate on one `thread/` floor, then declares debts from that floor to run and wire. `ThreadAggregate.ts:35–65` imports both native-run services and `protocol/resume`; `ThreadCompaction.ts:45` imports the pure provider-pair repair from `run/toolPairing`. This is a confirmed dependency-boundary gap, not evidence that every service is cyclic. Existing limitation [[808916e7]] states the same coarse-floor problem. The remedy belongs to the package's ownership map and its direction check, not aliases around the imports.

## K2. The harness is both assembly and a broad operational surface

`AgentHarness.ts:136–175,203–335,342–545` composes ports, native run owners, optional collaboration/workflow/resources, lifecycle reactions, observation and command methods. Even an omitted workflow still builds its engine; even omitted collaboration builds envelopes and reports (`278–321`). A single construction point is useful, but omission is not an independent dependency boundary. Existing claims [[b4a4c425]] and [[d4c4d3c9]] qualify today's behavior correctly. The target must separate fixed composition from ready owners and expose optional capabilities explicitly; a generic plugin framework is not implied.

## K3. Compaction already has the right preparation/settlement distinction, but its proposal still carries work into the unit

`ThreadCompaction.ts:1236–1282` prepares checkpoint data and a `covers` closure; the closure hashes the locked prefix and possibly all stored history. `ThreadCompaction.ts:809–839` writes newly pruned-call marks independently before proposing the history fold. The former makes transaction cost depend on history, and the latter is a separate monotone durable decision, not a side-effect-free read. These are two distinct contracts: keep monotone prune intent, but represent the fold proposal as immutable data with a checked source revision, not a captured callback that repeats hashing under the writer. [[281decc9]] and [[9b20ce73]] are the affected present-truth owners.

## K4. A long-turn prefix search can remeasure the same suffix quadratically

`thread/compaction/prefix.ts:31–46` measures a whole turn and then, for each candidate cut, serializes another suffix until one fits. A long single turn with many eligible boundaries repeats work over the same messages. `ThreadRequestMeter.ts:57–87` avoids repricing known objects but still combines every covered message digest on each prefix proof. These are source-level complexity findings, not timings. Prefix/suffix cost tables and immutable prefix identity belong to the context owner that produces these measurements; a consumer cache or a timer would not remove the work.

## K5. A pinned evidence target is not obtained in a single storage observation

`ThreadIntrospection.ts:140–146` reads `journal.headPosition` and `ledger.runsOf` as two concurrent effects with no shared transaction/snapshot argument. A run beginning between them can make provenance and the head describe different instants. The verified claim [[73b40c30]] promises one observation more strongly than this implementation establishes. The target needs one adapter-owned consistent snapshot of head and ledger; a simultaneous `Effect.all` is not that guarantee. This reading does not assert that every production invocation has reproduced the race.

## K6. Unreadable evidence bypasses the work counter

`ThreadIntrospection.ts:191–217` advances an unavailable record's source key and appends its diagnosis, then continues before incrementing `read` or checking the ceiling. An arbitrarily large unreadable population is therefore not bounded by `RECORDS_PER_QUERY`; its diagnoses also accumulate without the ordinary row-byte check. [[9ac665e5]] is overbroad for unavailable records. The evidence owner must count examined source records, including failed decodes, and bound diagnosis bytes, output bytes and aggregation state separately without silently treating missing facts as zero.

## K7. Evidence reconstructs the same run index per batch

`ThreadIntrospection.ts:327,374–385` rebuilds a map and set over the pinned run ledger for every batch. Runs are immutable within one query pin, so this costs batches × runs rather than runs + examined records. Construct the index once in the evidence reading. The current query also accepts an unchecked `ThreadQuery` (`72–75,148,163`), despite importing `checkThreadQuery`; [[9b0a744a]] records this limitation. The real external decoder should produce an admitted query value, and trusted internal execution should consume that value rather than repeat validation or accept raw user input.

## K8. The event check guards only the unused append-only entry

`ThreadEventDoor.ts:68–91` decodes payloads in `appendThreadEventsIn`, whereas the production sealed acceptance path appends directly at `94–120`. [[e8e39d1c]] already tracks this. The target removes the unused second append API after checking consumers, validates persisted/external event input at its actual codec boundary, and lets kernel-authored typed events flow to the single keyed transition. It does not add a second decode to every trusted reducer.

## K9. The promise face is not transitively promise-only

`promise/index.ts:91–99,204–230` special-cases returned handles and streams but not `toolDoor`; `AgentHarness.ts:486–488` returns a native Effect-valued door. The promise configuration lifts resources but passes collaboration/workflow through (`promise/index.ts:150–161,190–194`), and the separately declared promise tool interface maps only verdict/execute/outcome (`267–285`). This is a confirmed boundary mismatch, already tracked by [[fedfe7e5]] and accurately limited by [[784c9de0]]. The target is a closed promise application surface with explicit adapters for returned capabilities; Effect-only composition remains labelled as such.

## K10. Declared wire types do not constrain the fields actually serialized

`protocol/http.ts:44–64` omits `handedOverAt` and `settledNotifyAttempts` from the public run type; `351–367` spreads both into the result. Type/schema equality at `250–253` compares declared types, not runtime output. [[ba48beac]] tracks the concrete mismatch. A positive projection from the public schema is the owning repair. Wire budgets also require honest units: the existing caps and page weights count JSON string length, not encoded bytes, and cap severable tool fields rather than every possible entry ([[898ac62b]], [[fe4f1e0d]]).

## K11. Compacted live replay is still unbounded by episode size

`ThreadLiveFeed.ts:40–58,139–235` merges chunks and replaces transient slots, but has no byte/entry budget for the episode; closed text, reasoning and call events stay until close or another open. Activity replacement leaves null slots. `agent/AgentReplayLog.ts:12–17,42–63` retains every entry and returns the retained backing array. This is a retention limitation, not proof of a leak after owners release their logs. The target separates lossless durable recording from bounded live replay and gives a lagged viewer an explicit resnapshot result; it must not drop durable facts or invent complete replay after an eviction.

## K12. Compaction can lose prior successful-pass usage from its returned result after a later failure

`ThreadCompaction.ts:1058–1080` accumulates pass usage only in local variables and returns it only after every pass succeeds. `998–1032` retries the next eligible summarizer after failure without carrying the failed member's successful earlier passes into the returned summarizer. Completed request trace events may still retain evidence (`1184–1213`); this finding is about the returned/durable aggregate path, not a claim that the provider did not bill or no trace exists. Model attempts must own usage facts independently of the later summary outcome, with run/compaction totals derived from those facts.

## K13. Compaction's runtime policy validation is partial

`ThreadCompaction.ts:312–324` checks only `toolPruneProtectShare`; the remaining numeric policy in `policy.ts:3–14` is trusted by the selection arithmetic. [[681993b4]] describes an old comment's ordering, but today's source no longer states that ordering. The target must derive constraints from the actual arithmetic: finite nonnegative token counts, integral turn counts, a valid min/max interval and valid fractions/triggers. It must not blindly turn a removed comment's `buffer > maxRecent` assertion into a new product rule. Constructor dependencies currently share an options bag (`282–309`), separately tracked by [[5d6e2c8e]].

## K14. Composition shares round independently

`thread/composition/requestComposition.ts:116–124` rounds every part independently, so part totals need not equal the billed/estimated total. [[0ef3e10f]] already tracks this. This is a small projection-contract fix in the context evidence owner: deterministic remainder allocation preserves the measured total; the tool and orientation sub-breakdowns reconcile against their own parent, not a second independently rounded copy.

## B. Model, tool and product boundaries — astra-model's reading

The following source readings are supplied by coarchitect `astra-model`; product-specific adapter and MCP details were also read by its bounded product collector. They are retained here so the evidence does not depend on a temporary scratch report.

| Finding | Evidence and limit | Owner |
|---|---|---|
| B1 Concrete model bridge below loop | `packages/agent/src/agent/turn/call.ts:19` and `turn/plan.ts:17` import `ModelRequests` for pure helpers; `ModelRequests.ts:4–14` loads HTTP/client/resolution machinery. Profile imports are types, so this is not evidence that vendor profiles currently load. | Kernel model contract and explicit adapter |
| B2 Model client has no owned close | `packages/llm/src/models/client.ts:9–11` creates and drops a scope; `route/transport/verbatim.ts:229–237` registers connection-pool release on it. | LLM scoped client; product provider composition |
| B3 Detached abort watcher | `agent/ModelRequests.ts:99–110` forks detached; natural stream completion closes the transport scope, not that watcher. A direct stream caller whose signal never fires leaves it waiting. The ordinary turn later aborts its own signal (`AgentTurn.ts:155–158`), so one leak per normal attempt is not claimed. | Model-call lifetime |
| B4 Preparation outside frame deadline | `llm/src/llm/route/client.ts:540,509–512` compiles/signs/prepares before framed liveness at `:399`; `transport/http.ts:109` loads auth; profile credential contract `profiles/profile.ts:12–25` has no signal. | Provider credential ownership and model preparation |
| B5 Nested retry allowances | `transport/http.ts:146`, `executor.ts:66,517–521` retry under the kernel's `AgentTurn.ts:250–321` / `turn/retry.ts:56–91`. Profile policies disable some inner retry but can return `again` repeatedly (`route/client.ts:605–640`). No universal exact attempt count is asserted. | Shared logical-call budget |
| B6 Failed-attempt accounting | `route/client.ts:571–640` refolds and returns final response; `AgentTurn.ts:321,331,361` replaces a failed attempt before final fold. Trace/context observations may still retain earlier evidence. | Attempt receipts; product spend ledger |
| B7 Soft exclusion used for hard skill gates | `AgentSkill.ts:94–104` and `AgentDeferredTools.ts:80–98` both emit `exclude`; `AgentRuntimePolicy.ts:217–242` changes offered tools, but `turn/tools.ts:139–148` resolves execution from full sources. | Tool admission, distinct from discovery |
| B8 Unattended changes authority | `AgentApproval.ts:3–7` returns trust for unattended input; `permissions/index.ts:147–163` applies mutation/network mode floor only in review. This is confirmed current behavior; changing it is a deliberate target change. | Approval/permission policy boundary |
| B9 A body that failed can be labelled unexecuted | `AgentToolDoor.ts:1062–1069` marks begun then executes the body; `turn/tools.ts:266–289` maps caught failures to `executed:false`; `turn/fold.ts:16–17` folds that error arm. | Tool effect evidence |
| B10 Unbounded invocation fan-out | `turn/tools.ts:176,262` uses unbounded concurrency; `:184–204,433–445` scans preceding writes and lexical paths per call. | Bounded dependency-ready scheduler |
| B11 Unbounded uninterruptible cleanup | `AgentCalls.ts:331–345` waits for release and detached delivery before final completion; the body envelope cannot cut that masked wait. | Invocation custody and cleanup |
| B12 Fixed product policy in shared code | `callProgress.ts:31–34` fixes ten-minute acts and a doubled envelope; `AgentRunner.ts:93,109` fixes retained call history at 200; `agent-tools/bash.ts:6,819` and `search.ts:2,32` import the act policy. | Product-supplied limits |
| B13 Structured terminal facts flattened | `AgentFailure.ts:121–127` replaces some call-identity failures with ordinary errors and unwraps wrappers; `AgentTurn.ts:414–429` uses that terminal projection. | Typed terminal outcome |
| B14 Permission entry is not browser-callable whole | `permissions/index.ts:247–248` executes `new Bun.Glob`; actual app consumers use types/constants. An import walk is insufficient evidence of runtime portability. | Pure vocabulary versus server evaluator |
| B16 MCP call/ping failures bypass redaction | `packages/mcp/src/McpSession.ts:148–165` omits the redactor supplied by connect/list at `:224–265`; existing task [[42cb8372]] owns it. | MCP session/SDK boundary |
| B17 Error-body excerpt is not a read bound | `packages/llm/src/llm/route/executor.ts:268` reads `response.text()` whole before diagnostic truncation at `:185–187`. | Transport byte reader |

Provider-executed tool calls intentionally bypass local dispatch (`turn/tools.ts:399–402`); the target's single tool door applies to host-executed calls. Shared credential refresh belongs to the account owner, not whichever waiter cancels first.

## S. Storage and recovery — bounded collector reading

The storage collector read all thirteen storage port files, the lease/reaper/ledger/recorder/settlement owners, aggregate/run/inbox adapters and schemas, and Tagma's event floor/folds. It did not read the entire turn-runner or conformance implementations; no runtime claim is inferred from an unread path.

- **S2 Migration barrier incomplete if it uses ordinary reaping.** The reaper selector excludes awaiting-question: Tagma `ThreadRunStore.ts:533–550`; `ThreadRunReaper.ts:141–166,283–323` traverses those selectors. The accepted upgrade requires every old native running row ended. A separate all-writer/parked-row barrier is needed.
- **S3 Whole-state work inside current units.** `ThreadStreamRecorder.ts:281–316,403–479` folds under `updateAtomically`; Tagma `ThreadStore.ts:500–550` materializes state and catches up a suffix. Renaming the methods cannot meet the prepare-outside-hold target.
- **S4 File/SQL atomicity is not supplied by a transaction callback.** Tagma `ThreadEventLog.ts:48–105` invokes floor mint before SQL; `ThreadFloor.ts:178–201` appends synchronously and advances memory. SQL rollback cannot roll back that file. The accepted product journal/export recovery must close this seam; the kernel cannot promise two-resource atomicity. **Closed (c9c48cea):** the commit point is now SQL — `thread_event` issues the position in the same write unit, rollout is written as the unit's tail after COMMIT, rollback leaves no rows, a lagging file catches up via adopt at the next open; see [[df760b9f|thread journal]].
- **S5 Settlement is repeated as a whole bus.** `ThreadRunSettlements.ts:21–40` runs subscribers in order; `ThreadSettlementOutbox.ts:114–135,170–185` retries the publication, while `:156–166` fans out thread groups without a concurrency bound. Adapters stop claiming at their attempt ceiling. Current subscribers therefore need idempotence by run; one successful subscriber may run again after a later failure. No exactly-once external publication is established.
- **S6 Database fencing is narrower than external-effect fencing.** Both adapters fence running-row writes by owner/status; `ThreadRunLease.ts:614–639` heartbeats through a void-returning write. An obsolete driver may hold local work until it learns it lost custody. This is a takeover risk, not proof of duplicate effects; already dispatched external work requires its own witness or remains uncertain.

Existing good guarantees remain: the single active-run index, atomic run-end/tail/thread phase, output-reference participation in the history unit, and explicit unsettled-tool uncertainty. The accepted target's contradictions—repeat-stale treated as defect, product-specific evidence union, birth-lane summary, last-digest-only replay, status-only run-end replay and flush-count migration—are corrected explicitly in [[44f7f1c3|the accepted decision's amendment section]], not relabelled as current code defects.

## P. Collaboration, workflows and resources — bounded collector reading

The planes collector read all 32 production files in collaboration/workflow/resources and their graph zones, plus the precise external-participant/birth sites needed to compare the roads.

- **P1 Native fallback and duplicated admission.** `CollaborationParticipants.ts:10–18` is an optional opt-out with accepts/owns/spawn/deliver/stop/continue/delete; `ThreadEnvelopes.ts:245–271` and `ThreadSpawnTree.ts:1070–1079` otherwise take native paths. Tagma `Stack.ts:596–607` supplies the external branch; `HarnessBirths.ts:119–178` repeats provision/name/admission behavior. There is no common catalog/runtime contract today and no general cancel verb. Native `completeRun` reads its run ledger/transcript (`ThreadEnvelopes.ts:395–524`) with no participant branch; how external sessions reach that path was not established.
- **P2 Budget/seats do not cover every road.** Budget checks and seat acquisition stand in native `spawnChild` (`ThreadSpawnTree.ts:603–608,661–667`), not the external spawn branch (`1070–1078`) or fork (`974–1023`). Seats are process-local counters/sets (`248–250,1091–1120`); restart loses that occupancy while other children can still run. Budget is a check before birth rather than a fenced reservation. Current claims [[a17f8e06]] and [[474a36fa]] are broader than these roads establish.
- **P3 Model menus freeze admission early.** `CollaborationTools.ts:909–954` constructs provider/model/reasoning literal enums at run opening. A newly offered model can be rejected by decode before the current catalog judges it. Agent-type admission was already moved to the edge, but these model fields retain the old staleness shape.
- **P4 Resource release is awaited inside the database unit.** `resources/threadResourceLedger.ts:25–34` awaits each kind's release before dropping its row; `ThreadAggregate.ts:329–340` invokes it under the lifecycle unit. The callback contract permits external work while the writer is held; a concrete external side effect would not roll back with SQL. Duplicate kind names collapse (`threadResourceLedger.ts:22`), an unknown retained kind fails release (`52–58`), and an omitted plane uses an empty ledger (`16–19`).
- **P5 Workflow terminal/recovery surface is incomplete.** `workflow/engine.ts:290–345` provides a token-fenced drive lease, but only product calls to start/advance drive it (`AgentHarness.ts:530–541`); no kernel driver is composed. Nothing invokes finish with stopped, and no stop verb exists. This confirms existing [[d2b49e17]], not proof that every product lacks its own driver.
- **P6 Workflow bounds differ by ingress and restart.** JSON schema caps pack width while authored compile paths do not (`compile.ts`, existing [[ebe739ed]]); nested workflow calls have no depth/total-work bound. `engine.ts:153–169` starts pack members sequentially; `collaborationWorkflowMembers.ts:25–39` gives a resumed wait the full step deadline again. Token fencing prevents displaced ledger writes, not all duplicate external effort while a lost lease is being detected.
- **P7 Pending populations are unbounded.** The authored collaboration message has a 20k character bound (`CollaborationTools.ts:36–37`), but pending inbox rows, waiters and report retention have no corresponding capacity admission. `ThreadEnvelopes.ts:612–695` re-reads pending rows on changes. Page/output caps do not bound that producer work.

Current request/report idempotence, lineage rights, address uniqueness and workflow lease-token semantics are worth preserving. The target unifies the actual admission point and required runtime, rather than widening the optional external participant until it shadows the entire native aggregate.

## Reading limits and agreement

The two architects challenged one joint design; this was not an independent implementation review. `astra-model` agreed after the draft distinguished shared refresh custody, actual resource-owner fencing, bounded wire assembly, dependency-ready scheduling, provider-executed calls, native command coordination, hook-specific outputs, rejected alternatives, changed-claim dispositions and the standing model-client rule. The collectors supplied facts and bounded analyses, not acceptance verdicts.

The architects did not reproduce races or benchmark complexity. Existing claims marked drifted were treated as readings to check, not invalidated by that label alone. The accepted target preserves the current semantics not explicitly changed and names its amendments to earlier decisions separately. Existing stale findings are not cleared by this review.
