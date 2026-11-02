---
id: 01a17c69-62f3-7da2-9ca4-e79e08537878
title: "Dissecting 412 expensive itests: A/B/C classes, world cost and savings estimate across nine areas"
ord: 45
---
Moving logic off the runtime world gives a local win; most expensive areas check real resources and end-to-end paths. Below is a classification from reading current tests and owners; savings are estimates, no new runs were made.

## Data and method

Baseline: `~/.tagma-dev/scratch/01a17b03-b000-7845-9386-0b5c969fce44/integration-n8-pair.json.d/apps%2Ftagma%2Fserver%3Atest%3Aintegration.jsonl`, a green run, 8 workers. File CPU is `file.total.cpu / 1000`; child git/SQLite CPU is already inside it and never added twice. Percent denominators are 2145 CPU s of the whole integration run from the order; file sums may differ from run CPU. This is a sample of this machine and load, not a universal cost. The JSONL is no snapshot of sources: current read code was classified while CPU stayed from the baseline. Some files have since gained tests (e.g. workers/platformReach, remeasure, modules, commandNotice); new scenarios get no old numbers/CPU. So ranges are estimates with margin, not before/after.

A class is assigned by a file's substantive subject, not by name or by the mere presence of an HTTP/native call. A is the public owner's logic provable over fast adapters, or a covered unit duplicate. B is real SQL/FTS/transaction, git, FS, watcher or process boundary. C is a real caller path where door, admission, identity/place, serialization or native/CLI wiring matter. In a mixed file the letter marks the leading protected contract, not the kept suffix and not a promise to move the whole file. A may keep a separately preserved B/C witness when the main matrix checks policy; B holds extractable A-subscenarios when a substantive standalone resource contract stays the main subject. These remainders are named explicitly. For example composeAgent is A by composition/offer policy matrix, while write→read_changes/ChangeRecord/SQL route stays a separate native/resource witness; for change-record native bytes/CAS/SQL continuity are standalone main contracts of mixed B files. Class CPU bins are coarse whole-file marks by that judgment, not exact assertion-by-layer splits and not a list of files to rename wholesale. The "door world with no door subject" mark is transverse: such files' CPU is already inside A/B/C, not a fourth addend. File CPU is a ceiling on the affected work, not a promised saving.

The last pilot total [[01a17c3d-bd2d-70b9-ae91-3344226a797b|landing-unit]] was read: A≈38, B≈133, C≈56 CPU s of 227; moving A estimated at 20–25 s, narrowing more to 10 s. Its local 65% body cut of `submitEqualLines` does not carry over automatically to other areas.

## Summary

All values are CPU s. The DW column is the cost of files on a door world with no needed door subject, not a separate addend and not a saving.

| Area | Files | A | B | C | Total | DW | A+narrowing estimate, net |
|---|---|---:|---:|---:|---:|---:|---|
| composition/testing/threads | 70 | 21.0006 | 130.0395 | 98.4074 | 249.4475 | 45.5839 | 11–18 |
| composition/testing/http | 48 | 1.4475 | 75.7235 | 149.7622 | 226.9332 | 77.1710 | 8–15, mostly narrowing |
| graph | 87 | 0.3908 | 186.4425 | 0 | 186.8333 | 0 | 0.45–1.5 |
| composition/testing/enforcement | 42 | 28.8300 | 114.9654 | 40.6141 | 184.4095 | 18.3940 | 14.8–23.4 |
| enforcement | 27 | 0 | 70.5278 | 34.0102 | 104.5380 | 0 | Not established; delete junk separately 1.7–1.8 |
| composition/testing/graph | 41 | 4.8793 | 121.8125 | 27.5986 | 154.2904 | 2.7642 | 1–3, including DW |
| composition/testing/native-harness | 40 | 38.4348 | 49.1574 | 59.2345 | 146.8267 | 16.8732 | Net unknown; 8.311 gross setup isolated |
| composition/testing/change-record | 40 | 24.4772 | 118.5514 | 3.0414 | 146.0700 | 0; narrow graph candidate 16.1684 | 26.5–38.5 |
| composition/testing/cli | 17 | 0 | 18.8449 | 89.0480 | 107.8929 | 0 | No confirmed opportunity found |
| **Total** | **412** | **119.4602** | **886.0649** | **501.7164** | **1507.2415** | **160.7863 door; plus 16.1684 graph** | **≈62–99, native net excluded** |

No separate junk class is disguised as A: enforcement/eventLoop is marked B† by its current FS/import-scanner subject and gets a "delete" outcome, with no unit replacement. A kept real boundary in B/C does not mean every assertion inside the file needs it. For example naming/composeAgent/enforce have mixed remainders named explicitly below.

## Estimate and priority

Over areas with a numeric engineering range, moving A/extractable A-subscenarios is estimated at about 46–69 CPU s (2.15–3.22% of 2145); neutrality narrowing is already inside this. Non-overlapping narrowing of other worlds adds 16–30 s (0.73–1.41%). Together ≈62–99 s, or 2.9–4.6% of full integration CPU. This is a forecast marginal suite win keeping resource/door witnesses and counting new unit cost, not a measured result and not a promised wall speedup.

Native-harness cannot be honestly added to this net: 8.311 s of removable old setup isolated (own accountSelection world + pure composeAgent graph tenants), but the new adapters/conformance cost is unestablished. So 62–99 is the estimated part of the other areas, not a full numeric range for all nine; the full net from one reading stays unknown. The large native A budget of 38.435 s is not declared a saving.

Another 5–12 s could come from cutting redundant fixtures in kept B (graph 4–9 and incremental 1–3); this is different work, not in 62–99. Deleting two weak eventLoop/retirementFollow tests adds about 2.1–2.3 s separately. Worlds are already shared per worker: "each file minus a cold runtime" arithmetic is wrong.

Top three areas by expected win over new architecture work, qualitative order (person-hours unmeasured):
1. **composition/testing/threads, 11–18 s.** Start with declaredAgents/team/delegation/titleRoads through ready public ports and saidFill/shelf narrow driver worlds. Leave real expensive PTY/ACP tests alone. HarnessMoves/observation-title need new ports next, a more expensive step inside the area.
2. **composition/testing/http, 8–15 s.** Narrow to existing SQL/git owners, with no new memory git/SQL and no new domain algorithm. Start with journal/history/commit reads, graphSync, projectCatalogs; not terminal/worktree composition. Needed caller-name/serialization remainders preserved.
3. **composition/testing/change-record, 26.5–38.5 s A+narrowing.** Largest absolute confirmed subject reserve including mixed A. More substantial work: first one semantic PreparedChanges input/tree-plan port, then several repeating paths/whole/retained/team/programmatic scenarios over it; not a new fake Git per test. Other ledger/history ports are separate steps.

composition/testing/enforcement has an absolute 14.8–23.4 s estimate but needs a ModuleState/path/checkout/measurement evidence set plus Act.unit/worker conformance at once; so its win-per-new-boundary ratio is worse than the cheap moves above. Both graph areas are already mostly narrow SQL/git and yield only ≈1.5–4.5 s from a layer switch. Native ready-port cases are architecturally useful, but the numeric net does not yet rank them above these three on proven ratio.
## Per-file dissection

Names below are relative to `apps/tagma/server/src/`; `.itest.ts` omitted. The number by a name is the whole-file baseline CPU s. Tenths/hundredths rounded for reading only; sums use source milliseconds.

### graph — 87 files, 186.8333 CPU s

A: 4 files / 0.3908 s. B: 83 / 186.4425 s. C: 0. No spare door world: files already on demoGraph/twin/graphPool.

A files: `operations/registry 0.0903`, `serving/retries 0.0995`, `tree/ledger 0.0078`, `work/tasks/specs 0.1932`.

- registry checks the `list_root_blocks` envelope through invocation/testing execute, not a real door; the public operation body reads `Selection.roots`. A whole Selection adapter suffices, no new port needed.
- retries checks `FreshnessGate.register/fresh/beforeAct`: `MirrorBuilder`, `Mirrors`, `GraphSteps`, `Background` already ports, syncRegistry already double. A narrow context/TestClock needed instead of a SQL tenant.
- ledger checks `treeLedger.wrote/echoes` and clock expiry. The unit obstacle is a direct lstatSync; a domain `TreeWitness.read(path) → absent/dir/file(size,mtime,ctime,ino)` with native and fast conformance is needed. For this file's 0.0078 s a port does not pay off.
- specs checks `Blocks.update`/`Tasks.close` policy, but mutation is direct Drizzle. A full unit needs a domain port for conditional block state/patch writes under Act, with real SQL conformance of atomicity; fake StoreDb will not do. For 0.1932 s merging setup with an existing SQL scenario is cheaper. Exact full unit cover of these four files not established.

B files by subfolder (CPU s):

| Subfolder | Files |
|---|---|
| acts | names 0.2828 |
| blocks | blocks 2.7857; blocksRecords 1.4162; history 1.4812; linking 3.8731; storedColumns 0.0919; trash 0.2424 |
| core | Act 0.6308; actLanding 0.0725; bodyLaw 0.4189; rankingMatrix 2.2685; reads 0.1771; tagLifetime 0.4560; treeFloor 0.2681 |
| journal | eventLog 0.6191; feed 2.3693 |
| orientation | Instructions 0.8108; law 1.6819; prime 1.3766; touches 1.3972 |
| reading | block 0.5149 |
| search | ranking 1.2763; selection 2.3673; selectors 1.5698 |
| serving | advance 3.5377; advanceCommit 1.6141; cancellation 1.1019; concurrencyDrill 2.0718; copies 5.1414; folder 7.1079; freshness 4.3349; identities 1.4294; lanes 9.0917; levelling 3.4782; machineWriter 0.9877; projects 3.5440; recovery 1.8204; references 3.3431; routing 5.6175; servingDrill 12.1952; storageMove 2.6783; titles 3.7391; treeMarks 3.6079; treeRefresh 3.3463 |
| sources | sources 0.2532; sourcesChange 0.9846; sourcesPlaces 1.7382 |
| steps | coreNames 0.2070; moduleCards 3.2196; operationNames 0.6943; platformsDeclared 3.1703; ruleDelivery 0.9822; ruleInspections 0.1252; sequence 0.9915 |
| storage | retirement 5.0780 |
| tree | branchChanges 0.5166; checkoutRecovery 1.2814; commits 6.5057; conflicts 1.1346; export 0.2499; freshness 1.9639; freshnessMatrix 3.2025; layout 0.0342; merges 2.8866; projectDelta 1.3453; projectDeltaMatrix 2.9844; projection 4.2953; repairMatrix 5.0044; retirement 4.1538; scan 0.4705; shadow 1.9674; topology 4.3921; twins 4.6795 |
| work | Batch 2.5499; proposals/filing 1.5451; proposals/listing 2.7544; proposals/verdicts 1.2157; retirement 0.6224; statusBinding 1.1203; supersession 1.7469; tasks/ending 1.5687; tasks/holders 0.3171; tasks/holding 0.3529 |

Basis for B: `Ranking.search` runs FTS MATCH, tier CASE, window count and keyset SQL (`search/ranking.ts`); `Selection.query/queryPage` has JSON/role predicates and recursive CTE (`search/selection.ts`). `Act.unit` holds savepoint/rollback/onCommit (`acts/unit.ts`), `BlockEdit` rereads the row and winner call under unit (`blocks/edit.ts`), `Tasks.claim` uses a conditional UPDATE (`work/tasks/holding.ts`). So this is SQL conformance, not a reason to write a second SQL in Map. Tree/serving check real mirror/bytes/index/HEAD/watch/reopen; 79.888 s of serving do not become pure logic from a service name. Graph git in most logic files is only template scaffolding; a new git port makes no unit files of them.

Extractable A-subscenarios do not equal a mixed file's CPU:
- `blocks/history` first seven bodyDiff tests already run without a tenant: body 0.2598 s, of which 0.2063 s from rewrite(200000). Moving the suffix does not remove that compute, so this cost is not counted as a saving. `journal/eventLog` first three journalBatches tests likewise cost 0.0009 s without a tenant.
- Guard subscenarios for body cap, source-kind, anchor shape, amendment scope and status/actions can move; kept rollback/SQL projections stay B. `work/statusBinding` tests 1/3/4 hold 0.6997 s body+tenant, but test 4 contains writes: that whole budget does not lift. The full public mutation path needs the port named above.
- Read `tree/treeNaming.test.ts` cases on first taker/ord/id, symbols/reserved index and nested render cover pure naming, not a disk orphan-directory roundtrip from layout.itest. `work/lifecycle.test.ts` cases on custom tag claim/finish and undeclared word cover `checkTransition`, not conditional UPDATE, holder/status/ready/journal consistency.

Real A/mixed move estimated at 0.45–1.5 CPU s (0.02–0.07% of 2145), door-world narrowing 0. A separate setup-consolidation lever in kept B, not counted in this saving, aims at 4–9 s: fewer SQL tenants and repeated scalar scenarios in B. For ranking/selection/blocks/blocksRecords/linking/Batch/verdicts the tenant budget totals 7.5285 s, but isolation/rollback scopes cannot all merge. That is separate setup work, not a unit-move effect.

### composition/testing/graph — 41 files, 154.2904 CPU s

A: 5 / 4.8793 s. B: 31 / 121.8125 s. C: 5 / 27.5986 s. The only confirmed spare full door world is A neutrality 2.7642 s; its narrowing is already inside the A estimate.

| Class | Files: CPU s |
|---|---|
| A | vocabulary/subtypes 0.3090; vocabulary/layerWrite 0.6590; vocabulary/neutrality 2.7642; work/endingDebt 0.8626; work/workEnds 0.2845 |
| B | baselineRace 5.1909; farEdges 6.6624; threadCopies 9.4018; core/tagNodes 3.1333; journal/sessionNames 0.3104; journal/sessions 0.4352; serving/bootVocabulary 3.1855; serving/branchLens 1.8432; serving/journalMachine 1.6257; serving/mirrorMove 4.3861; serving/registryActs 4.9901; serving/rewriteFiles 3.3692; serving/storageById 5.6528; serving/topologySync 5.3960; serving/treeLedger 2.4697; serving/vocabularyFormat 5.7332; serving/writeThrough 6.9003; tree/holderCopies 4.4749; tree/knowledgeNames 3.6660; tree/mirror 10.8806; tree/softwareDevelopmentNames 0.7069; vocabulary/catalogs 4.7468; vocabulary/closure 0.6892; vocabulary/defaults 1.9204; vocabulary/findings 4.5901; vocabulary/identity 4.6254; vocabulary/knowledge 0.4725; vocabulary/typeStorage 0.3724; work/endingSpec 3.6454; work/endingSpecFar 7.4083; work/enforcement 2.9278 |
| C | copiedBlocks 5.5486; createClaim 0.8550; idleCopies 10.1977; threadWork 6.0625; writerSessions 4.9348 |

A:
- subtypes → TagIndex/redeclare/tagById, assertTagNode and validateFields/assertRequiredFields; compiler unit already covers inheritance/missing base/redeclaration, but an exact inherited-required carrier case is needed. No new port.
- layerWrite → writtenLayer/prepareCandidate. `candidate.test.ts › a fork stays as written and a newer shipped revision of its type writes nothing` is the read exact fork-decision cover; add the empty keyed-layer case. For these pure decisions no port needed. Full Blocks.update→installation storage stays B; its unit orchestration would need an InstalledVocabulary/release-base snapshot port instead of StoreDb, not recommended for two cases.
- neutrality → TagIndex/bornFields/checkTransition on an exact pair of opposite workflows. Read lifecycle/roles/profile units cover parts, not the whole pair; add it to unit. Keep the SQL ready per-tag active/terminal contract already in `graph/work/statusBinding.itest.ts › one tag ending at a word another merely passes through: ready and the outline answer per tag`, not fake SQL. Do not move the prompt-section assertion.
- endingDebt → public WORK_PAIRS with a real endResult without commit, over Orientation/Tags/Tasks/BlockNames. This is debt-entries aggregation by owner, not a SQL query; ports already exist, no equal unit established.
- workEnds → public WORK_PAIRS prepare/execute with a real makeWorkEnds and ready Caller/domain doubles. This is actor/type/word/commit→event projection; invocation/testing with withGraphCall is no real C door. No new port needed.

B: real mirror/storage migrations, SQL selection/index/FTS/recursive openWork and rollback, file ingestion/projection/watch/close lifetimes. In particular endingSpec runs recursive SQL/NOT EXISTS, not a simple response mapper. journal/sessionNames directly body.execute checks a SQL join of writer with thread metadata; not a door. Candidate/compiler/codec units do not prove SQL carriers/rollback/type_id/derived index or persisted rows of graph steps.

C: copiedBlocks/createClaim/writerSessions pass a real native catalog over the graph world; this is NOT a full runtime and no removable "server boot". ThreadWork needs grants/home/project/cwd/create_thread wiring. IdleCopies genuinely checks boot/upgrade and HTTP/socket responsiveness while holding an opening: own runtime is the subject here, not scaffolding.

A+mixed move estimated at 1–3 CPU s (0.05–0.14% of suite). Neutrality door→graph estimated separately at 0.3–1.2 s, but already inside that 1–3; on a different shared-worker order the effect may approach zero. Both graph areas together aim at 1.5–4.5 s of layer moves only; another 4–9 s of setup consolidation in kept graph B is different work and not added to the shared A+narrowing.
### composition/testing/threads — 70 files, 319 tests, 249.4475 CPU s

A: 8 files / 21.0006 s. B: 47 / 130.0395 s. C: 15 / 98.4074 s.

| Class | Files: CPU s |
|---|---|
| A | declaredAgents 3.5388; delegation 0.1414; harnessAcceptance 0.1317; harnessReaders 0.0996; hostedAccounts 8.5756; naming 4.4713; team 1.4547; titleRoads 2.5875 |
| B | attention 8.2325; claudeConformance 10.7537; commandEndings 0.3361; commandNotice 4.2513; conversations 5.1804; developerRollout 0.3263; folders 0.3570; forkCatchUp 2.8636; forkPrefix 4.1047; forkRestore 0.6975; formSteps 1.6937; harnessSpend 0.0549; harnessTitleAdopt 0.2888; inboxKeys 0.2220; journalBirth 0.2208; journalCarry 1.3483; lifeReads 0.0773; listStore 0.8659; listWindow 0.1605; modelChanges 0.0577; namingRollout 0.0972; notes 0.1540; pins 0.1029; placement 3.6432; projection 0.8148; protocolRoad 12.9772; repair 0.2502; report 0.2096; rest 2.4952; restedComposition 3.0700; restedReads 2.7411; restedReadsWake 0.2584; rolloutDrill 2.1498; rolloutSync 2.5061; runActivity 7.4359; saidFill 4.1762; sessionRows 0.1256; shelf 4.1241; targetContexts 1.4827; targetIntents 0.1633; targets 4.2167; teamDirectory 0.1038; terminalConformance 5.4728; terminalHistory 22.5177; threadArchive 6.4965; titles 0.0745; transportSeats 0.0870 |
| C | birthAuthority 10.1102; birthPlace 6.9929; claudeContinue 7.1408; claudeCut 3.3056; externalCaller 4.0704; heldTasks 5.2660; hostedFork 7.8285; hostedMove 8.1065; hostedReveals 9.7344; operatorMessage 6.1517; protocolHandover 3.8386; protocolTransport 3.9456; purposeActivity 6.4768; teamPlaces 3.2674; threadMove 12.1720 |

A owners and unit obstacles:
- `declaredAgents` → `makeDeclaredAgents.resolveIn/offeredIn/resolve/offered/filesOf` (`threads/library/declared.ts`). AgentFiles, AgentPackages, NativeAgents, Projects, Settings, ThreadRecords already ports; fast fillers needed plus one separate real discover conformance, no new git port.
- `delegation` → readDelegation/resolveDelegation over ThreadMandate/Settings; ready ports. Leave one recursive SQL lineage adapter as a B witness.
- `harnessAcceptance` → public HarnessObservations.admit(facet,event), the decision itself with no IO, but make is now tied to title SQL. A port for title identity/conditional adoption is needed, a real SQL filler and memory SessionRows; no private-helper export for the test.
- `harnessReaders` → wireThread/wireThreadFacts/wireThreadShape over materialized rows. A separate readerOrder write stays a SQL witness. Read `threads/list/wire.test.ts` model/source/root projection covers only part, not the whole itest.
- `hostedAccounts` → HarnessMoves.move (`threads/harness/moves.ts`). No real process in the test: let process and releasing double. A storage-domain selection/session binding port with atomic handover is needed because make reads native rows directly and writes MachineUnits. No fake ORM; one SQL handover conformance stays.
- `naming/titleRoads` → ThreadTitles.generate and the reported-event callback. Dependencies already tags: lookup/history/records/settings/model/credentials/asides/activity/inbox/rollout. A reusable owner fixture needed, not a full runtime. One native actor/trigger/activity read_thread_record witness from naming stays C; CAS title write separately B. Read `threads/naming/context.test.ts` excerpt/material projection proves, not captured/fresh/account/cancel policy.
- `team` → ThreadTeams.of/layers/promote/adopt through Settings, ThreadMandate, ProviderRegistry/ProviderAccounts. Ports ready; the real credential-file mtime was a way to invalidate the double, not policy subject.

The most expensive B must not be passed off as A because a memory conformance of the core exists: terminalHistory is real PTY quit/delivery, vendor cut and SQL realignment; protocolRoad/claudeConformance are real ACP process/restart/questions/session adapter contracts. SQL FTS, window ordering, generation CAS, afterCommit publication and row/file restore also need the real boundary. `sessionRows.itest` and `external-harnesses/store/sessions.test.ts` call one describeSessionStore on SQL and memory: this is a required conformance pair, not a duplicate to delete.

Door world with no door subject: A `hostedAccounts/titleRoads` = 11.1631 s; B `forkCatchUp/forkPrefix/rolloutDrill/saidFill/shelf/threadArchive` = 23.9149 s. Also B `runActivity/restedComposition` = 10.5059 s pass HTTP merely as a convenient consumer of storage/read invariant, also narrowing candidates. Total marked file cost 45.5839 s (strictly no-door-call 35.0780 s); the A part does not add up again with its move.

Narrow set: sharedPool MachineStore/MachineUnits + needed ThreadRecords/journal/branch/list/rollout/resources/FTS owners, a real FileSystem and scripted kernel/transport ports. `saidFill` builds makeRuntime with no door at all, `shelf` an own maintenance world. Their world CPU 3.4510+2.9701=6.4211 s is only a budget, not the whole saving: narrow driver/SQL/FS also cost nonzero.

Realistic estimate: A 8–12 s plus non-overlapping B narrowing 3–6 s = 11–18 s (0.51–0.84% of suite). The 21.0006 s of A are not removed whole: body is only 14.2665 s, hostedAccounts load 5.9812 s may reattribute to a neighboring file, and provenance/CAS/hook witnesses plus unit fixtures stay. Most profitable first are ready-port declaredAgents/team/delegation/titleRoads and narrow driver saidFill/shelf; a new HarnessMoves storage port is the next, more expensive step. Unmeasured births/acts cuts inside C are not added here.

### composition/testing/native-harness — 40 files, 146.8267 CPU s

A: 8 / 38.4348 s. B: 18 / 49.1574 s. C: 14 / 59.2345 s. Strictly spare door world: A accountSelection/operatorNotes — 16.8732 s of files, not that much saving.

| Class | Files: CPU s |
|---|---|
| A | accountSelection 8.7113; callLifecycle 8.5401; compactionSummarizer 4.5736; composeAgent 5.9716; lawTools 0.4363; operatorNotes 8.1619; runLog.stops 1.1348; runLog.turns 0.9052 |
| B | activityWindow 6.6680; contextReceipt 0.7961; evidence 7.4138; externalRecord 0.4645; foldedFacts 0.9348; folds 0.8602; historyRows 0.4313; library 10.3860; openQuestions 0.2224; queryConformance 3.4249; relations 3.4194; rewindRows 0.6574; runLog.openingCost 2.1775; settlementRestart 0.9045; storagePort 2.8943; storageRuns 6.4813; threadStorage 0.6939; transitions 0.3271 |
| C | artifactFrames 8.8090; backgroundEnding 12.3526; commandOutcome 5.0672; fileClaims 0.0379; graphCrossing 4.9953; graphFiles 4.1273; graphQueuePages 4.4837; graphTools 3.3537; mcpRoots 0.7649; placePolicy 2.2338; sessionTools 0.3394; startCost 4.7108; storageMove 7.3271; worldTools 0.6318 |

A and needed ports:
- accountSelection → DefaultAccounts.adopt/save/defaultAccount and ModelPreferences.setModelSettings, memory ThreadHandle/Births. The owner itself now builds makeAccountDefaultRows/MachineUnits: a semantic default-account state/revision port with atomic read/write and afterCommit moved is needed, one SQL CAS/revision conformance stays. A ProviderAccounts double alone does not solve this.
- callLifecycle → CallActivity.feed/snapshot/control, AgentCalls.open/control and ThreadHandle.answer/send on a memory harness. An owed-ending ledger port (owe/began/end/settle) is needed for recovery/owed delivery since MachineUnits write tied SQL. Leave parked handoff rollback and restart delivery narrow B.
- compactionSummarizer → CompactionChoices/Compaction.compact and ThreadHandle.compact/send. CacheWarmth/lookup/records/settings/quota/registry and memory ThreadStorage already ports. Add a memory warm-account-invalidation/checkpoint/next-request case; leave the read_compaction_choices HTTP mapping a short C.
- composeAgent → ThreadAgent.prepare/start/toolCatalog, not a private mounted/helper. Capabilities/offers/context/rows/mandate/team/data ports and memory FS suffice for pure overlay/deferred/web cases. Real read/write/bash, attributed change-record/touch/instruction revision routes stay B/C. Do not move prompt/copy pinning.
- operatorNotes → the real notesRule through agentRule/beforeStep with a scripted memory AgentHarness and OperatorNotes port. Check input metadata/history snapshot, not prompt strings; SQL write/switch is a separate boundary.
- runLog.stops/turns → ThreadHandle.delete/send + inbox.put through ready memory storage/gates. Exact new delete-while-settling and agentReaderInput cases needed: the read runLog conformance is not named equal cover of these cases.
- lawTools → Blocks.setDelivery/setEnabled/update, operation-owned law slots. A semantic law-state mutation port with atomic persistence is needed for unit. For 0.4363 s a separate port does not pay off alone: nearest practical outcome is a narrow graph-owner itest plus one native warning C.

Read partial covers: native-harness/calls/activity.test.ts opening-project-window; AgentCalls.test.ts stop-one-cleanup/sibling and background-later-result-once; calls/delivery.test.ts detached/cut owed ending; compaction/choice.test.ts empty chain/own model and native-vs-vendor spendable; agents/prompt.test.ts ordered edits/refusal and registration.test.ts frozen unrelated execution. They confirm an existing pure owner but give no equal cover of all approval/parked/late-result/compaction/account/capability scenarios. SQL conformance storagePort/storageRuns/relations is not deleted because a memory half exists.

B: real SQL projection/checkpoint/suffix/rollback/reopen/FTS index or FS atomic revision/symlink/write-lock at library. QueryConformance compares SQL ActivityRecord with kernel algebra — exactly the real-adapter half. C: real native catalog/caller/place/serialization routes; artifactFrames genuinely runs a managed browser, backgroundEnding bash/FIFO/host handover, mcpRoots stdio MCP, storageMove an already prepared native read and the next model step after graph move. These paths cannot be replaced with memory without losing the subject.

In native no numeric net range is established from one reading. One concrete removable old setup isolated: own accountSelection world 7.1044 s + graph tenants of 12 pure composeAgent cases 1.2066 s = 8.3110 s gross (0.387% of suite). Body of these composeAgent cases 0.5992 s keeps running in unit and is not written off. New fast-adapter/SQL-conformance/remaining-witness cost unknown, so 8.3110 is not added as net saving. OperatorNotes shared world 4.6012 s may move to the next file and is also not subtracted. Extra narrow candidates in B are evidence/queryConformance/library, with no numeric guarantee.
### composition/testing/change-record — 40 files, 191 tests, 146.0700 CPU s

A: 9 / 24.4772 s. B: 30 / 118.5514 s (including B† retirementFollow). C: 1 / 3.0414 s. These are conservative bins by a file's main kept contract: many B files hold extractable A-subscenarios. Their labels are not exact per-assertion CPU splits; per-file totals and separate test.body splits mean different things. By test.body the source dissection found A 43.8782, B 83.6896, C 0.8730 s, overhead 17.6292 s; A there still holds retirementFollow bookkeeping, moved out as separate here. Do not paint shared overhead over assertions without new measurement.

| Class | Files: CPU s |
|---|---|
| A | channels 0.9448; commandMarks 0.6705; explicitLanding 1.5327; holdingsProperty 2.8710; programmatic 11.4130; retainedLanding 1.7791; retainedSweep 1.1852; retirementLeases 2.4031; teamLanding 1.6778 |
| B | budgets 1.2757; changeFrontier 3.9583; commandJournal 2.8063; commandLanding 6.9543; commandLessons 0.8369; commandMoves 5.9907; commands 6.0647; crossProject 5.0639; debtRewrite 0.7305; holdings 7.5228; ignoredInputs 3.3637; incremental 5.4797; lineWrites 0.0401; metadata 5.6618; operatorWindows 0.5099; operatorWrites 2.0313; parallelEdits 3.3810; recordedMoves 3.3995; reshape 3.5341; retirement 3.5304; retirementProofs 4.1891; revertLines 9.3457; stepDebt 2.9462; stripComments 4.6821; threadAuthorship 8.9429; threadCommits 6.5353; threadFiles 7.0234; versions 1.2267; workspaceChangeLog 1.0644 |
| B† | retirementFollow 0.4600 |
| C | symlinkIntake 3.0414 |

† retirementFollow checks only watches===1 — mock bookkeeping with no outcome. Delete with no equal race-cover claim; its separate 0.46 s is not issued as logic moved.

A owners and new ports (names mark proposed subjects, not existing symbols):
- explicitLanding/retainedLanding/teamLanding/programmatic → public PreparedChanges.prepare. Paths/whole, nobody additions/deletions, retained peer slicing, team-root taking and whole/typed provenance are policy, not shell/git semantics. A semantic SelectedChange snapshot/tree-plan port is needed: changed/clean/move paths, provenance/attributes/indivisible, holder/retained/team facts, base/working sides and the chosen-plan builder. Today prepareChange/programmaticPaths read Git/SQL directly. The port returns a tree/paths/holders, not argv; a real tree/index builder is proven once in B. Existing prepared/sweep.test.ts checks lock/preparedBase cleanup, not this selection policy.
- channels/holdingsProperty → Holdings.subscribe/threads and ThreadChanges.subscribe/read. Domain Holdings-input snapshot and typed ledger with controlled changed-state events are needed. Keep the existing fold/authoring. Property today compares two projections, not an independent ownership model: replace with a minimal deterministic own→external→revert→commit unit, not a scattered random matrix.
- commandMarks → ChangeRecord.land/report + CommandChanges.open/settle, semantic intents/publication ledger and metadata/head, memory FS bytes. Failed land/typed publication/interval are not equal to the read lives unit digest/instant choice. Durable command marks stay in commandJournal B.
- retainedSweep → ChangeRecord.sweep/unattributed with clean/standing state and ended-holder facts. retirementLeases → Retirement.lease/pass with history(head/reachability/introduced sides), retire ledger and command-close/CheckoutRows events. Today the owner itself builds the SQL store and reads git history; swapping one watcher is not enough. Lease sequencing itself uses no resource.

Extractable A cases of mixed files (number is the baseline it.effect, with no claim on current numbering): changeFrontier 1–4; commandLanding 4/8; commandLessons 1; holdings 1/6/10/11/14–17; recordedMoves 3–4; reshape 2/8–9; retirementProofs 1–3/8–9; revertLines 3–4/9; threadAuthorship 2–6; threadFiles 1–2/4–5/8–9/13/15/17. These are stale/net-zero/slice/provenance/selection/annotation/proof sequencing, not real git modes/CAS/SQL rollback. Only these A-subscenarios of mixed B give 20.1883 s body: expected net win 9–14 s, not whole file totals.

B keeps real fsmonitor/command measurement/process overlap, git replace/ignore/status/index/CRLF/mode/rename, byte CAS, merge-file, durable SQL replay/refcounts/proof and query-plan boundary. The 0.0401 s lineWrites is useful cheap conformance, not a delete candidate because another test looks similar. Real sparse-file metadata checks no body read; 24 GiB mean no such written volume. C symlinkIntake proves exactly native prepare→execute: the symlink changes after prepare, the write goes to the already bound target, delete owns another directory entry/project. A direct ChangeRecord.report does not keep this signal.

Read partial covers: record/commands.test.ts named-path/opaque-writer policy; lives.test.ts team/overlap and no-write-is-no-writer; commandRows.test.ts deletion/birth byte pairing; holdings/requests.test.ts failure/woken request; record/roles.test.ts relative/outside role facts. They do not prove real shell measurement, root-taking selection, across-two-command pairing, fresh fold lease or lessons restart. Unread fold/parser/fuzz unit is not declared equal to the whole scenario.

No spare DoorWorld here. There is spare broad graph setup at parallelEdits/crossProject/stripComments/symlinkIntake: 16.1684 s file.total, 7.5530 s world+tenant. Record+sharedPool SQL/roots/files/Git/native implementation by subject is needed, not a graph catalog/demo births. Marginal narrowing estimate 3–5 s; the SQL child-host saving of stripComments already inside, not a separate plus. Real symlink/root identity/prepare-execute stays.

Estimate with no double count: nine A files ≈14.5–19.5 s net (from a 15–20 source estimate for ten minus retirementFollow deletion); mixed A 9–14 more; narrowing of four B/C graph setups 3–5. Total ≈26.5–38.5 s, 1.24–1.79% of full integration CPU. Separately, shrinking the 1000-path incremental fixture while keeping the real query-plan subject may give 1–3 s; it is neither A nor world narrowing, so not included here. Shared net unmeasured: the top needs new product ports and conformance, not a suffix rename.

### enforcement — 27 files, 104.5380 CPU s

A: 0. B: 70.5278 s. C: 34.0102 s. Confirmed broad door world with no door subject: 0 whole files.

| Class | Files: CPU s |
|---|---|
| B | baseMerge 8.3733; letThrough 3.4510; heldDebt 8.2605; workers/platformReach 3.8659; mergeDriver 4.9342; CommitQueue 1.7729; commitHooks 5.1068; programs/eslint 3.3323; programs/ast-grep 1.2470; commits/graphMerge 2.1425; CommitQueueRecovery 3.2424; programs/facts 1.6882; workers/modules 4.3364; workers/inspecting 2.6532; programs/oxlint 0.4909; Inspections 0.1812; programs/bindings 1.0735; cache/store 0.1472; programs/versions 0.3178; programs/command 0.3234; programs/group 0.3063; rules/measurements 0.4086; workers/retirement 0.0541; workers/inspectionLanes 0.0436; landing 10.9674 |
| B† | eventLoop 1.8072 |
| C | commitGate 34.0102 |

B here is real git merge/index/hooks, worker process/loss/replacement, program runners/loaders, FS measurements or SQLite/WAL/cache. `workers/inspecting.ts` itself builds a ManagedRuntime with Git/FS inside the worker: swapping parent-side Git does not remove this resource. `cache/store.ts` checks real WAL/flush/reopen/corruption, `commits/queue.ts` durable JSONL worker/ACK/recovery; a path:null unit does not cover the durable part. `programs/files.ts` reads real modes/blobs, `programs/loading.ts` the judged-tree Bun loader. No memory Git.run argv replaces these assertions.

C commitGate passes the real CLI check/op and installed git hooks: session/foreign, own git, pull, unavailable server and reentrancy. The door is the subject, not overhead scaffolding.

† eventLoop is a quality exception: import-closure pinning reads the real checkout but proves no runtime contract. It must be deleted with no replacement; this is not A and not a unit move. Separate deletion estimate: 1.7–1.8 s (0.08% of suite), not in the A+narrowing total.

Mixed A: the last `CommitQueue` ceiling scenario can move to the public commitQueue(path:null); the port already exists. Read `CommitQueue.test.ts` admission/close/preflight cases do not cover durable recovery; `programs/group.test.ts` coverage/value/answer-validation cases do not cover process/loading; `commits/graphMerge.test.ts › a held debt entry both sides keep stays held through the merge of the debt` does not cover real mergeDriver conflicts. So these units are not declared equal cover of whole B files. No numeric win for these small A-parts established.

### composition/testing/enforcement — 42 files, 184.4095 CPU s

A: 8 files / 28.8300 s. B: 29 / 114.9654 s. C: 5 / 40.6141 s. Confirmed spare door world at B: `movedLaw 9.5542` and `configTightening 8.8398`, 18.3940 s of file cost in total; marginal saving only 1.7–4.3 s.

| Class | Files: CPU s |
|---|---|
| A | enforce 6.9966; lawType 2.8951; layers 2.2817; moduleLaw 3.8043; modules 2.7634; programs 1.9524; remeasureDelta 2.3105; triggers 5.8260 |
| B | configTightening 8.8398; enforcePrograms 2.4353; enforceWrite 5.3895; engines 4.4577; escapeOrigin 9.4460; files 1.5797; generatedConfig 1.1833; inspectionFailed 4.7384; inspectionKeys 8.2283; installedConfig 1.3822; linterConfigs 2.0894; mergeGraph 4.9375; mergePublication 2.8545; mergeRecovery 4.6145; mergeSource 4.0560; mergeUncertain 2.0634; moduleStale 3.4477; movedLaw 9.5542; programRoad 2.1438; programSources 1.5625; programsCounted 3.5210; publication 3.2382; remeasure 7.1091; remeasureHeads 2.8091; remeasureJournal 0.6459; remeasurePasses 0.8087; remeasurePrograms 2.5926; remeasureRaces 2.9007; remeasureStart 6.3364 |
| C | absorbCheckout 9.2927; copiedLaw 11.8421; finishDebt 6.4491; modulePreview 2.3228; remeasureIdle 10.7074 |

A needs owner boundaries, not fake SQL and not git argv:
- `enforce` → public enforce_rule (`planEnforcement/applyEnforcement`), debt/owner/absorb/off policy. Inspections/Configs already ports; a checkout/measurement snapshot is needed: HEAD/tree/declaration, delta and rename lineage. Leave one actual graph write and renamed-file measurement fallback in B.
- `modules/moduleLaw` → set_module (`planModules/applyModules`). ModuleState (cards/identities/ancestry/revision) and path/checkout facts needed; today the planner reads Blocks and statSync. `applyModules` atomic freshness+writeModules under Act.unit stays real SQL B. The existing moduleMap.test is not named equal cover of the whole operation.
- `lawType` → check_rules/enforce_rule over an arbitrary law-role vocabulary, Tags/Orientation and a ready inspection result. A real landing adds no signal to role choice.
- `layers/programs/triggers` → public RuleChecks.before/after/check_rules over typed checkout/change evidence, attribution and Inspections/ProgramRoad readings. Runner ports already exist; a single shared domain evidence port is needed instead of direct HEAD/base/blob/ownership reads in judging. Leave real program/config/symlink adapters in B.
- `remeasureDelta` → public remeasureRule/Remeasure over a measurement/tree delta snapshot. Today the owner itself reads treeOf/measurementsOf/diffTreeAt up to partitionLedger: swapping one Inspection is not enough. File delta/rename conformance stays B.

This is architecture work over several states/paths, not mechanical suffix renaming. A estimate by files: enforce 3.0–4.2; modules 1.5–2.2; moduleLaw 0.8–1.2; lawType 2.0–2.6; layers 1.3–1.9; programs 1.1–1.6; remeasureDelta 1.4–2.0; triggers 2.0–3.4 CPU s. Total 13.1–19.1 s (0.61–0.89% of suite), not 28.83 s.

B keeps a real git/config/resolver/history/CAS/SQL boundary. In particular `escapeOrigin` reads real code/config/merge-parent history and missing git objects; `moduleStale/enforceWrite` compare footprint/revision between prepare and apply; remeasure Journal/Start/Races prove durable replay and publication races. Merge files factually belong to landing Merges/MergeGit though they live in enforcement testing. Most of this folder is ALREADY on a narrow enforcement/graph world (`enforceFixture`), not a door world.

`movedLaw` can stay graph+Configs with two real projects (estimate 0.7–1.8 s), `configTightening` prepared-change+enforcement+record (1.0–2.5 s). The shared door build is still needed for C and is not subtracted. `remeasureIdle` is mixed: two native submit/check_rules paths are needed for the chosen copy/readiness, lifecycle subparts can narrow, but baseline/current cases changed — no separate saving attributed. Combined A+narrowing of this area: 14.8–23.4 s (0.69–1.09% of suite).

### composition/testing/http — 48 files, 226.9332 CPU s

A: modulesDoor 1.4475 s — checks only the modules composition of the set_module answer (modulesDoor.itest.ts:25–34), not SQL atomicity/staleness/reopen. `planModules` builds the list from request slots (rules/modules.ts:472–499,525–542), apply only appends new card names. Move through the public set_module and a ModuleState/path/checkout port already proposed for enforcement/modules; no exact equal unit cover established. Real SQL freshness+write stays separately B. For this one file alone a new port is not justified; move it together with the set_module owner.

B: 75.7235 s. Every listed file uses a broad door world, though the asserted subject can stay on the owner's operation in a narrow itest. This is affected cost, not saving.

| File | CPU s | Substantive subject |
|---|---|---:|
| projectCatalogs | 3.0066 | Catalog choice pinned in project settings, survives release/reopen and user-default change; SQL/state lifetime. |
| projectsDoor | 4.8587 | Stealth-graph birth, tree files and shadow with no user `.git`. |
| graphSync | 6.6947 | Unborn team-repo root commit, private index and kept staged code. |
| checkoutHistoryDoor | 6.4945 | Real git history/path/grep/branch and pinned HEAD cursor. |
| checkoutCommitDoor | 4.1603 | Git rename/first parent plus SQL overlay of thread lines. |
| commitSteps | 3.4911 | Real program road of the formatter, index and working-file reshape. |
| mergeTakesBase | 9.5204 | Git merge graph from base to enforcement and parent topology of the published merge. |
| worktreeTerminal | 4.5984 | Real worktree deletion and a live PTY process above its directory. |
| journalDoor | 5.8318 | SQL cursor/join with a deleted block and unreadable installation on FS. |
| projectRename | 6.6009 | Kept id, graphs, mirrors, remote, threads on rename/remove/return and reopen; mixed with caller-name routing. |
| settingsDoor | 6.1262 | Project-layer write/clear through both operations; pure resolveSetting covers only part, not storage write. |
| filesExistsDoor | 3.7892 | Real symlink, chmod/unreadable, physical containment and missing-path distinction. |

C: 149.7622 s.

| File | CPU s | Door's substantive subject |
|---|---|---:|
| collaborationDoor | 8.8082 | CLI grant, messages/reports, server operations and subscriptions. |
| reflectWorktree | 8.7295 | Credited caller in a worktree, local law and reflection routing in main at HTTP/native. |
| reflectDoor | 3.9523 | Foreign project caller, server provenance with no receivedBy takeover, lifecycle through operations. |
| approver | 8.6581 | Parent/takeover/detach approval routing, HTTP grant and repeated answer. |
| graphRecovery | 4.0060 | The door starts and re-recognizes one recovery thread and resolves the conflict. |
| threadProjectDoor | 3.0173 | Named-thread home, implicit/explicit project and the same refusal at native/HTTP/CLI selector. |
| threadsDoor | 3.1558 | Multipart uploads/serving, paging, seen/favorites and request decoding. |
| instructionRefresh | 3.4466 | Refresh through an operation; the next real scripted run takes the new frozen definition. |
| worktreeGraph | 4.1072 | Thread move to a checkout and the next native tool writes exactly its graph. |
| settingsPlace | 4.4284 | Foreign-target law/approval and project by id/cwd. |
| workflowsDoor | 5.4102 | End-to-end workflow run, scripted model reports, chair and fault composition; pure scheduler subsets possible, the whole file not unit. |
| operationsDoor | 3.1434 | HTTP decoding/admission, contract/outcome headers, JSON/media/text, approval repeat. |
| changeRecord | 3.6931 | Record with a session grant, unsigned refusal and landing of the credited hunk. |
| sites | 5.5651 | Host-origin routing, CSP/frame policy, IPv6 bind boundary. |
| authDoor | 2.4150 | OAuth loopback/device sign-in and key ingress through the door. |
| graphFormat | 5.9714 | A detached caller gets its upgraded graph, but the write is refused in its place. |
| threadTypeDoor | 3.3414 | Runtime modes → wire menu/settings → default agent at the next birth; mixed owner logic, end-to-end path kept. |
| backgroundDoor | 3.5887 | HTTP/native background receipt, owed calls and completion. |
| updateStartsThread | 5.9123 | Worktree update through the door births/reuses the standing thread there. |
| checkoutActsDoor | 7.2977 | Public pull/commit/abort caller path over real git. |
| sandboxImportDoor | 2.5246 | An unconfirmed caller cannot import a file by any path. |
| filePreview | 4.1893 | place_path and HTTP preview outside the checkout, headers and symlink serving. |
| agentWorldDoor | 6.4275 | Native declaration-file read allowed only in the caller world. |
| adoptDoor | 6.8496 | Hook/HTTP adoption gets the physical cwd of the needed checkout. |
| doorParity | 5.6838 | Caller, answer and typed refusal agree at HTTP/native. |
| admission | 8.4593 | Graph conflict does not close stop/chat over socket/HTTP, graph read keeps the refusal. |
| artifacts | 2.3724 | Real artifact routes: range/download/cache/CSP/version. Already a narrow shelf, no runtime world. |
| worktreesDoor | 2.4376 | Listed repository → prepare/create/replay through public HTTP. |
| faultsDoor | 2.1448 | An HTTP defect recorded once with the addressed thread/project. |
| accountsDoor | 0.7174 | Wire accounts/default revision/removal for a missing provider/harness. |
| actDoor | 4.8813 | Caller session/run/step provenance and machine foreign key. |
| startup | 0.8942 | A real listener answers pending migration/refusal, then serves on the same address. |
| door | 0.0135 | Real HTTP unknown-route JSON refusal. Already a narrow listener. |

Why B needs no new git-port for unit: `workspace/checkouts/reads.ts › makeGitCheckoutReads` is already a real `CheckoutHistory` adapter, calling headAt/logAt/commitFilesAt; replacing git removes the subject of these assertions. `projects/registration.ts` writes the registry in a transaction and physical identity; graph lifecycle/sync read and write the mirror. `enforcement/rules/modules.ts › applyModules` compares state and writes cards in one Act.unit. `settings/resolution.test.ts › answers the key default when nobody set it` and `› lets a project decide what the user only proposed` cover value/from but not the layer write/delete from `settingsDoor`; not named equal cover of the whole file.

A narrow world here means a real Graph/Projects/Settings/Workspace/Worktrees/Executions set by subject, with a SQL pool and real git where needed, not memory git. For `projectRename` keep a separate short caller-name smoke or leave this file C; B here estimates the main persistence subject, not an order to drop routing. For `modulesDoor` the subject is the output projection (A), not the fact that the current pipeline runs SQL; its move links to the shared ModuleState port, not a separate test-only seam for 1.45 s. `filesExistsDoor` cannot be wholly replaced with memory FS: chmod/realpath/symlink semantics stay on the real adapter.

Expected saving of the area A+narrowing: 8–15 CPU s (0.37–0.70% of 2145), mostly from narrowing the listed B, not 77.17 s of all marked files' cost. No separate net established for the single A modulesDoor; its move is not added as a second plus on top of the range. The shared door build is still needed for C files, so its world build cannot be "removed" per file. Clearest first candidates: journalDoor, checkoutHistoryDoor/checkoutCommitDoor, graphSync and projectCatalogs; complex worktreeTerminal is not a first move. Other small scalar assertions in A modulesDoor are not estimated as a whole file.

### composition/testing/cli — 17 files, 107.8929 CPU s

A: 0 s. B: 18.8449 s. C: 89.0480 s. No confirmed broad door world without a real door: the `harnessHosting` file uses the native hosting door though placed under cli; this is C, not argv logic.

| Class | File | CPU s | Reason |
|---|---|---:|---|
| B | ensureServer | 18.8291 | Real startup/adoption/restart/channel-lock/listener processes; the own ensure world is justified by the lifetime subject. |
| B | adoptedWitnessMigration | 0.0158 | Real SQL migration with row/lease/session-shape assertions; already a narrow in-process DB. |
| C | hookAdoptionBridge | 3.7445 | Header/signature/exchange caller at real HTTP+CLI hooks. |
| C | worktree | 2.4243 | Operation-id path prepare/create/read/adopt. |
| C | hookRecord | 6.1575 | Real hook argv/stdin/grant ingress to typed change-record, including concurrent/retry. |
| C | mcpServe | 8.5967 | Stdio MCP bridge catalog/call/refusal/media and exit on stdio close. |
| C | harnessHosting | 10.3865 | Real hosted native tool: once/replay/cancelled and foreign-law gate; FS side effect proves no repeated execution. |
| C | argv | 7.3686 | JSON inline/file/stdin and stdout/exit code of the real CLI process; the parser unit already exists, this is no duplicate of its call. |
| C | threadEvidence | 8.5577 | One pinned cursor continued through CLI and MCP. |
| C | compact | 3.8146 | CLI compact/unqueue on a running thread. |
| C | hookPlace | 8.3453 | First terminal hook carries the foreign checkout law, ACP guidance and multi-project touch. |
| C | hookAdoption | 11.4478 | Real CLI hook re-adoption, session store and migration composition. |
| C | hookPermission | 2.8385 | Hook permission with a real session/grant. |
| C | nativeSignature | 5.3816 | Proof identity through CLI/HTTP, invalid/deleted session does not sign. |
| C | hookReport | 2.5447 | Terminal hook gets the full law/report of the private checkout. |
| C | door | 0.0478 | Real local HTTP peer: typed refusal/retry/health decode. Already a narrow listener. |
| C | hookFirst | 7.3919 | First hook binds the server facet and gets guidance. |

`fixture.ts` builds a live HTTP listener; `tagma` enters the real CLI through `capturedEffect`, `spawned` a separate Bun process. `composition/cli/door.ts` uses a real HttpApiClient over FetchHttpClient; `external-harnesses/cli/hook.ts` owns hook ingress. `argv.test.ts` already checks catalog/help/destructive confirmation without a server connection, and `argv.itest.ts` additionally proves stdin/stdout/exit and project/scope resolution. Moving these 17 files to unit gives no confirmed saving. Removing extra births/calls inside C is possible separately, but not an A move or world narrowing estimated here.

## Reading limits

Independent reviewer [[01a17c60-584d-7f64-864a-02e80b79d7a2|survey-review]] confirmed by reading 412/412 files, source totals and no double-count gross/native. Two confirmed remarks fixed: modulesDoor moved from B to A by its assertions/planModules; the method now explicitly distinguishes a file's leading contract from a kept mixed B/C residual, including composeAgent. The signed review was not rewritten, no second review.

No tests, typecheck, product, or report-processing scripts ran. For A the architecture direction and checked coverage are named where established; saving ranges are hypotheses for a later A/B pair, not a measured result. An end-to-end defect test whose report needs a concrete door must not be narrowed losing caller/place/preconditions: each such test's origin is checked on implementation.
