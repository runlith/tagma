---
id: 01a0e510-beb7-7002-b5fa-5ee54dfd93e7
title: "Vocabulary rename map: 377 names and their targets at f29c9e006d"
ord: 8
---
Every name a rename rule of the vocabulary decision reaches, measured at `restructure` `f29c9e006d` (377 rows): the rule, the current name, its kind, file:line, region and target. Produced by the Opus design; rows of families the rulings changed follow the rulings.

```tsv
rule	current	kind	where	region	target	note
C2 shape	ModelsFaces	type	apps/tagma/server/src/ai/Models.ts:24	server	Models['Service']	no named shape
C2 shape	ProviderAccountsFaces	type	apps/tagma/server/src/ai/ProviderAccounts.ts:24	server	ProviderAccounts['Service']	no named shape
C2 shape	UnitsFaces	type	apps/tagma/server/src/db/Units.ts:13	server	Units['Service']	no named shape
C2 shape	InspectionsFaces	type	apps/tagma/server/src/enforcement/Inspections.ts:13	server	Inspections['Service']	no named shape
C2 shape	WarmTreesFaces	type	apps/tagma/server/src/enforcement/WarmTrees.ts:13	server	WarmTrees['Service']	no named shape
C2 shape	CommitHooksFaces	type	apps/tagma/server/src/enforcement/commitHooks.ts:172	server	CommitHooks['Service']	no named shape
C2 shape	TreeCommitsFaces	type	apps/tagma/server/src/files/TreeCommits.ts:44	server	TreeCommits['Service']	no named shape
C2 shape	StripCommentsFace	type	apps/tagma/server/src/files/stripComments.ts:55	server	StripCommentsOwner['Service']	no named shape
C2 shape	ActFaces	type	apps/tagma/server/src/graph/core/Act.ts:211	server	Act['Service']	no named shape
C2 shape	MeasureDrainFaces	type	apps/tagma/server/src/graph/core/Act.ts:52	server	MeasureDrain['Service']	no named shape
C2 shape	TreeFloorFaces	type	apps/tagma/server/src/graph/core/Act.ts:80	server	TreeFloor['Service']	no named shape
C2 shape	BlocksFaces	type	apps/tagma/server/src/graph/core/Blocks.ts:224	server	Blocks['Service']	no named shape
C2 shape	SelectionFaces	type	apps/tagma/server/src/graph/core/Selection.ts:174	server	Selection['Service']	no named shape
C2 shape	SettingsFaces	type	apps/tagma/server/src/graph/core/Settings.ts:27	server	Settings['Service']	no named shape
C2 shape	TagsFaces	type	apps/tagma/server/src/graph/core/Tags.ts:435	server	Tags['Service']	no named shape
C2 shape	GraphFeedFaces	type	apps/tagma/server/src/graph/journal/GraphFeed.ts:22	server	GraphFeed['Service']	no named shape
C2 shape	JournalFaces	type	apps/tagma/server/src/graph/journal/Journal.ts:132	server	Journal['Service']	no named shape
C2 shape	DoctorFaces	type	apps/tagma/server/src/graph/measure/Doctor.ts:129	server	Doctor['Service']	no named shape
C2 shape	SourcesFaces	type	apps/tagma/server/src/graph/measure/Sources.ts:136	server	Sources['Service']	no named shape
C2 shape	SweepWatermarkFaces	type	apps/tagma/server/src/graph/measure/SweepWatermark.ts:267	server	SweepWatermark['Service']	no named shape
C2 shape	ProjectsFaces	type	apps/tagma/server/src/graph/projects/Projects.ts:74	server	Projects['Service']	no named shape
C2 shape	ServedTreeFaces	type	apps/tagma/server/src/graph/projects/ServedTree.ts:7	server	ServedTree['Service']	no named shape
C2 shape	SessionsFaces	type	apps/tagma/server/src/graph/projects/Sessions.ts:20	server	Sessions['Service']	no named shape
C2 shape	ReviewFaces	type	apps/tagma/server/src/graph/work/Review.ts:157	server	Review['Service']	no named shape
C2 shape	AccountDefaultsFaces	type	apps/tagma/server/src/harness/AccountDefaults.ts:68	server	AccountDefaults['Service']	no named shape
C2 shape	AgentLibraryFaces	type	apps/tagma/server/src/harness/AgentLibrary.ts:7	server	AgentLibrary['Service']	no named shape
C2 shape	CallActivityFaces	type	apps/tagma/server/src/harness/CallActivity.ts:13	server	CallActivity['Service']	no named shape
C2 shape	EvidenceReadsFaces	type	apps/tagma/server/src/harness/EvidenceReads.ts:132	server	EvidenceReads['Service']	no named shape
C2 shape	HarnessDeliveriesFaces	type	apps/tagma/server/src/harness/HarnessDeliveries.ts:15	server	HarnessDeliveries['Service']	no named shape
C2 shape	HarnessPermissionsFaces	type	apps/tagma/server/src/harness/HarnessPermissions.ts:33	server	HarnessPermissions['Service']	no named shape
C2 shape	WorkflowsFaces	type	apps/tagma/server/src/harness/Workflows.ts:18	server	Workflows['Service']	no named shape
C2 shape	PermissionRulesFaces	type	apps/tagma/server/src/harness/PermissionRules.ts:8	server	PermissionRules['Service']	no named shape
C2 shape	ThreadActsFaces	type	apps/tagma/server/src/harness/ThreadActs.ts:80	server	ThreadActs['Service']	no named shape
C2 shape	ThreadEvidenceFaces	type	apps/tagma/server/src/harness/ThreadEvidence.ts:145	server	ThreadEvidence['Service']	no named shape
C2 shape	ThreadListFaces	type	apps/tagma/server/src/harness/ThreadList.ts:70	server	ThreadList['Service']	no named shape
C2 shape	ThreadRolloutsFaces	type	apps/tagma/server/src/harness/ThreadRollouts.ts:47	server	ThreadRollouts['Service']	no named shape
C2 shape	ThreadTitlesFaces	type	apps/tagma/server/src/harness/ThreadTitles.ts:45	server	ThreadTitles['Service']	no named shape
C2 shape	WorkspaceSourceCacheFaces	type	apps/tagma/server/src/harness/WorkspaceSourceCache.ts:16	server	WorkspaceSourceCache['Service']	no named shape
C2 shape	KeyboardFace	type	apps/tagma/server/src/harness/keyboardFixture.ts:127	server	Keyboard['Service']	no named shape
C2 shape	keyboardFaces	value	apps/tagma/server/src/harness/keyboardFixture.ts:134	server	keyboard['Service']	no named shape
C2 shape	CommandLedgerFace	type	apps/tagma/server/src/harness/worlds/CommandLedger.ts:14	server	CommandLedger['Service']	no named shape
C2 shape	FreshnessGateFaces	type	apps/tagma/server/src/http/FreshnessGate.ts:32	server	FreshnessGate['Service']	no named shape
C2 shape	FrozenFaces	type	apps/tagma/server/src/http/FrozenBuilds.ts:14	server	FrozenBuilds['Service']	no named shape
C2 shape	MirrorBuilderFaces	type	apps/tagma/server/src/http/MirrorBuilder.ts:112	server	MirrorBuilder['Service']	no named shape
C2 shape	ServingSwitchFaces	type	apps/tagma/server/src/http/ServingSwitch.ts:35	server	ServingSwitch['Service']	no named shape
C2 shape	McpServersFaces	type	apps/tagma/server/src/mcp/McpServers.ts:30	server	McpServers['Service']	no named shape
C2 shape	AgentPaceFaces	type	apps/tagma/server/src/power/AgentPace.ts:10	server	AgentPace['Service']	no named shape
C2 shape	AwakePolicyFaces	type	apps/tagma/server/src/power/AwakePolicy.ts:10	server	AwakePolicy['Service']	no named shape
C2 shape	TerminalsFaces	type	apps/tagma/server/src/terminals/service.ts:185	server	Terminals['Service']	no named shape
C2 shape	ThreadFloorFaces	type	apps/tagma/server/src/thread/ThreadFloor.ts:115	server	ThreadFloor['Service']	no named shape
C2 shape	ThreadStoreFaces	type	packages/agent/src/thread/ThreadPorts.ts:122	pkg:agent	ThreadStore['Service']	no named shape
C2 shape	threadStoreFaces	fn	packages/agent/src/thread/ThreadPorts.ts:145	pkg:agent	threadStore['Service']	no named shape
C2 shape	ThreadToolOutputScopeFaces	type	packages/agent/src/thread/ThreadPorts.ts:178	pkg:agent	ThreadToolOutputScope['Service']	no named shape
C2 shape	ThreadToolOutputFaces	type	packages/agent/src/thread/ThreadPorts.ts:193	pkg:agent	ThreadToolOutputVault['Service']	no named shape
C2 shape	PortFaces	type	packages/agent/src/thread/ThreadPorts.ts:60	pkg:agent	EffectPort<T>	type-level lift of a storage port
C2 shape	portFaces	fn	packages/agent/src/thread/ThreadPorts.ts:77	pkg:agent	port['Service']	no named shape
C2 shape	GitFaces	type	packages/git/src/Git.ts:41	pkg:git	Git['Service']	no named shape
C2 shape	CpuProfilerFace	type	packages/performance/src/CpuProfiler.ts:32	pkg:performance	CpuProfiler['Service']	no named shape
C2 shape	MemoryCapturesFace	type	packages/performance/src/MemoryCaptures.ts:25	pkg:performance	MemoryCaptures['Service']	no named shape
C3 tag	StripCommentsOwner	class	apps/tagma/server/src/files/stripComments.ts:59	server	StripComments	S3; the class now named X becomes the private implementation
C3 tag	BlockOwner	type	apps/tagma/server/src/graph/measure/Sources.ts:217	server	(keeps: the graph owner of a code path)	S3; the class now named X becomes the private implementation
C3 tag	FileOwner	type	apps/tagma/server/src/graph/measure/Sources.ts:46	server	(keeps: the graph owner of a code path)	S3; the class now named X becomes the private implementation
C3 tag	CompactionChoicesOwner	class	apps/tagma/server/src/harness/CompactionChoices.ts:322	server	CompactionChoices	S3; the class now named X becomes the private implementation
C3 tag	HarnessAdoptionOwner	class	apps/tagma/server/src/harness/HarnessAdoption.ts:23	server	HarnessAdoption	S3; the class now named X becomes the private implementation
C3 tag	ThreadFilesOwner	class	apps/tagma/server/src/harness/ThreadFiles.ts:1353	server	ThreadFiles	S3; the class now named X becomes the private implementation
C3 tag	ThreadMovesOwner	class	apps/tagma/server/src/harness/ThreadMoves.ts:120	server	ThreadMoves	S3; the class now named X becomes the private implementation
C3 tag	ThreadPlacementOwner	class	apps/tagma/server/src/harness/ThreadPlacement.ts:85	server	ThreadPlacement	S3; the class now named X becomes the private implementation
C3 tag	WorkspaceChangesOwner	class	apps/tagma/server/src/harness/WorkspaceChangeLog.ts:493	server	WorkspaceChanges	S3; the class now named X becomes the private implementation
C3 tag	PreparedTreeOwner	class	apps/tagma/server/src/harness/sandbox/PreparedTrees.ts:18	server	PreparedTree	S3; the class now named X becomes the private implementation
C3 tag	SandboxOwner	class	apps/tagma/server/src/harness/sandbox/Sandboxes.ts:38	server	Sandbox	S3; the class now named X becomes the private implementation
C3 tag	CommandAccessOwner	class	apps/tagma/server/src/terminals/CommandAccess.ts:439	server	CommandAccess	S3; the class now named X becomes the private implementation
C3 tag	CommandOutputOwner	class	apps/tagma/server/src/terminals/CommandOutput.ts:41	server	CommandOutput	S3; the class now named X becomes the private implementation
C3 tag	CommandReaderOwner	class	apps/tagma/server/src/terminals/CommandReader.ts:78	server	CommandReader	S3; the class now named X becomes the private implementation
C3 tag	TerminalAccessOwner	class	apps/tagma/server/src/terminals/TerminalAccess.ts:119	server	TerminalAccess	S3; the class now named X becomes the private implementation
C3 tag	TerminalGrantsOwner	class	apps/tagma/server/src/terminals/TerminalGrants.ts:334	server	TerminalGrants	S3; the class now named X becomes the private implementation
C3 tag	TerminalTargetsOwner	class	apps/tagma/server/src/terminals/TerminalTargets.ts:156	server	TerminalTargets	S3; the class now named X becomes the private implementation
C3 tag	CheckoutActOwner	class	apps/tagma/server/src/working/CheckoutActs.ts:276	server	CheckoutWrites (section 5: checkout writes)	S3; the class now named X becomes the private implementation
C3 tag	PendingMergesOwner	class	apps/tagma/server/src/working/PendingMerges.ts:242	server	PendingMerges	S3; the class now named X becomes the private implementation
C3 tag	WorktreeFinishingOwner	class	apps/tagma/server/src/working/WorktreeFinishing.ts:1122	server	WorktreeFinishing	S3; the class now named X becomes the private implementation
C3 tag	WorktreeRenamesOwner	class	apps/tagma/server/src/working/WorktreeRenames.ts:352	server	WorktreeRenames	S3; the class now named X becomes the private implementation
C3 tag	CheckoutReadOwner	class	apps/tagma/server/src/worktrees/CheckoutReads.ts:367	server	CheckoutReads	S3; the class now named X becomes the private implementation
C3 tag	ProjectStoreOwner	class	apps/tagma/server/src/worktrees/ProjectStores.ts:136	server	ProjectStore	S3; the class now named X becomes the private implementation
C3 tag	WorktreeOwner	class	apps/tagma/server/src/worktrees/WorktreeActs.ts:208	server	(the worktrees card names the subject: today's WorktreeActs)	S3; the class now named X becomes the private implementation
C3 tag	WorktreeCleanupOwner	class	apps/tagma/server/src/worktrees/WorktreeCleanup.ts:186	server	WorktreeCleanup	S3; the class now named X becomes the private implementation
C3 tag	WorktreeListingOwner	class	apps/tagma/server/src/worktrees/WorktreeListing.ts:296	server	WorktreeListing	S3; the class now named X becomes the private implementation
C4 bundle	DemoOwners	type	apps/tagma/server/src/graph/core/graphFixture.ts:58	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	WorkingFaces	type	apps/tagma/server/src/graph/projects/WorkingOwners.ts:29	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	WorkingOwners	class	apps/tagma/server/src/graph/projects/WorkingOwners.ts:40	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	ThreadOwners	type	apps/tagma/server/src/harness/owners.ts:30	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	ThreadDoorOwners	type	apps/tagma/server/src/http/handlers/threads.ts:82	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	HttpOwners	type	apps/tagma/server/src/http/operationBinding.ts:25	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	HttpOperationFileOwners	type	apps/tagma/server/src/http/operationBinding.ts:32	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	CommandActOwners	type	apps/tagma/server/src/operations/commands.ts:30	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	OperationOwners	type	apps/tagma/server/src/operations/nativeOwners.ts:28	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	TerminalActOwners	type	apps/tagma/server/src/operations/terminals.ts:48	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	ThreadChannelOwners	type	apps/tagma/server/src/socket/threadChannel.ts:35	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	GitOwners	type	apps/tagma/server/src/terminals/servingGit.ts:13	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	ExecutionFaces	type	apps/tagma/server/src/terminals/terminalsLayer.ts:68	server	(dissolve: each member its own tag)	service locator bag
C4 bundle	TerminalOwners	class	apps/tagma/server/src/terminals/terminalsLayer.ts:99	server	(dissolve: each member its own tag)	service locator bag
C5 deps	AccountDefaultsDeps	type	apps/tagma/server/src/harness/AccountDefaults.ts:102	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	WorkflowsDeps	type	apps/tagma/server/src/harness/Workflows.ts:34	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	TargetContextsDeps	type	apps/tagma/server/src/harness/TargetContexts.ts:55	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ThreadActsDeps	type	apps/tagma/server/src/harness/ThreadActs.ts:190	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ThreadContextDeps	type	apps/tagma/server/src/harness/ThreadContext.ts:94	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ThreadEvidenceDeps	type	apps/tagma/server/src/harness/ThreadEvidence.ts:188	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ThreadListDeps	type	apps/tagma/server/src/harness/ThreadList.ts:104	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ThreadMovesDeps	type	apps/tagma/server/src/harness/ThreadMoves.ts:28	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ThreadPlacementDeps	type	apps/tagma/server/src/harness/ThreadPlacement.ts:42	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ThreadRolloutsDeps	type	apps/tagma/server/src/harness/ThreadRollouts.ts:77	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ThreadTargetsDeps	type	apps/tagma/server/src/harness/ThreadTargets.ts:68	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	WorktreeNotesDeps	type	apps/tagma/server/src/harness/WorktreeNotes.ts:11	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ComposeDeps	type	apps/tagma/server/src/harness/agents/composeAgent.ts:39	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	DeclaredAgentsDeps	type	apps/tagma/server/src/harness/agents/declared/DeclaredAgents.ts:44	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	AgentLibraryDeps	type	apps/tagma/server/src/harness/agents/library.ts:77	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	WorldsDeps	type	apps/tagma/server/src/harness/worlds/Worlds.ts:34	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	CheckoutWorldDeps	type	apps/tagma/server/src/harness/worlds/managedWorld.ts:33	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	UpgradeDeps	type	apps/tagma/server/src/skill/upgrade.ts:18	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	HeldExecutionsDeps	type	apps/tagma/server/src/terminals/endHeldExecutions.ts:8	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	RootExecutionsDeps	type	apps/tagma/server/src/terminals/rootExecutions.ts:15	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	PendingMergesDeps	type	apps/tagma/server/src/working/PendingMerges.ts:35	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	ProvisionalBranchesDeps	type	apps/tagma/server/src/working/ProvisionalBranches.ts:24	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	UnbornWorktreesDeps	type	apps/tagma/server/src/working/UnbornWorktrees.ts:13	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	WorktreeFinishingDeps	type	apps/tagma/server/src/working/WorktreeFinishing.ts:130	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	WorktreeRenamesDeps	type	apps/tagma/server/src/working/WorktreeRenames.ts:34	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	WorktreeCleanupDeps	type	apps/tagma/server/src/worktrees/WorktreeCleanup.ts:20	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	WorktreeListingDeps	type	apps/tagma/server/src/worktrees/WorktreeListing.ts:46	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	WorktreeSetupsDeps	type	apps/tagma/server/src/worktrees/WorktreeSetups.ts:30	server	(remove: positional parameters, rule c2f04d22)	
C5 deps	AgentTurnDeps	type	packages/agent/src/agent/AgentTurn.ts:46	pkg:agent	(remove: positional parameters, rule c2f04d22)	
C6 port	AgentHostPort	type	packages/agent/src/agent/AgentFailure.ts:81	pkg:agent	AgentHostMember (keyof the contract)	pattern word never a suffix
C6 port	ThreadEventJournalPort	type	packages/agent/src/thread/ThreadPorts.ts:153	pkg:agent	ThreadEventJournal['Service']	pattern word never a suffix
C6 port	ThreadSummarizerPort	type	packages/agent/src/thread/compaction/summarizer.ts:34	pkg:agent	ThreadSummarizer	pattern word never a suffix
C6 port	SearchPort	type	packages/layer/src/svelte/test-utils/deferred-fixtures.ts:6	pkg:layer	(test utility: exempt)	pattern word never a suffix
C7 impl	LiveViewers	class	apps/tagma/server/src/terminals/LiveViewers.ts:29	server	ViewLeases (section 5 view lease)	
C7 impl	LiveTerminals	class	apps/tagma/server/src/terminals/live.ts:26	server	private implementation, e.g. HostTerminals	
V1 broke	AgentRunBroke	class	packages/agent/src/agent/AgentFailure.ts:106	pkg:agent	AgentRunFailed	
V1 broke	ThreadCallBroke	class	packages/agent/src/thread/ThreadBorder.ts:24	pkg:agent	ThreadCallFailed	
V1 broke	DrainLoopBroke	class	packages/agent/src/thread/run/ThreadDrain.ts:20	pkg:agent	DrainLoopFailed	
V1 error	MigrationChainError	class	apps/tagma/server/src/db/Store.ts:36	server	MigrationChainInvalid	judgement
V1 error	StoreError	type	apps/tagma/server/src/db/Store.ts:47	server	StoreOpenFailure	judgement
V1 error	BlockFileError	class	apps/tagma/server/src/files/BlockFile.ts:86	server	BlockFileInvalid	judgement
V1 error	BlockTreeError	class	apps/tagma/server/src/files/BlockTree.ts:12	server	BlockTreeUnreadable	judgement
V1 error	ConflictedBlockError	class	apps/tagma/server/src/files/Conflicts.ts:10	server	BlockConflict	judgement
V1 error	MirrorError	class	apps/tagma/server/src/files/Mirror.ts:57	server	MirrorRefused | MirrorFailed (split by reason)	judgement
V1 error	ShadowGitError	class	apps/tagma/server/src/files/ShadowGit.ts:6	server	OwnGitFailed	judgement
V1 error	StorageLayoutError	class	apps/tagma/server/src/files/StorageLayout.ts:25	server	StorageLayoutInvalid	judgement
V1 error	RolloutError	class	apps/tagma/server/src/files/ThreadRollout.ts:17	server	RolloutUnreadable	judgement
V1 error	ThreadRolloutSyncError	class	apps/tagma/server/src/files/ThreadRolloutSync.ts:29	server	RolloutSyncRefused	judgement
V1 error	ExportError	class	apps/tagma/server/src/files/exportGraph.ts:9	server	ExportFailed	judgement
V1 error	BatchSourceError	class	apps/tagma/server/src/graph/core/BatchSources.ts:20	server	BatchSourceUnreadable	judgement
V1 error	MissingBodyError	class	apps/tagma/server/src/harness/refusal.ts:207	server	BodyMissing	judgement
V1 error	ThreadInputError	class	apps/tagma/server/src/harness/refusal.ts:214	server	ThreadInputRefused	judgement
V1 error	ThreadOtherProjectError	class	apps/tagma/server/src/harness/refusal.ts:225	server	ThreadRefused (reason other-project)	judgement
V1 error	ThreadWriteConflictError	class	apps/tagma/server/src/harness/refusal.ts:235	server	ThreadWriteConflict	judgement
V1 error	DataDirectoryHeldError	class	apps/tagma/server/src/http/claim.ts:7	server	DataDirectoryConflict	judgement
V1 error	SpokenIdError	class	apps/tagma/server/src/protocol/identity.ts:39	server	SpokenIdRefused	judgement
V1 error	ThreadAttachmentNotFoundError	class	apps/tagma/server/src/thread/ThreadAttachmentStore.ts:160	server	ThreadAttachmentMissing	judgement
V1 error	BoundingError	class	apps/tagma/server/src/thread/ThreadEntryBounding.ts:31	server	BoundingFailed	judgement
V1 error	ThreadFloorError	class	apps/tagma/server/src/thread/ThreadFloor.ts:8	server	RolloutWriterFailed	judgement
V1 error	ThreadProjectionError	class	apps/tagma/server/src/thread/ThreadProjection.ts:12	server	ThreadProjectionRefused	judgement
V1 error	ThreadToolOutputNotFoundError	class	apps/tagma/server/src/thread/ThreadToolOutputStore.ts:36	server	ToolOutputMissing	judgement
V1 error	ThreadContextAttachError	class	packages/agent/src/thread/ThreadAggregate.ts:73	pkg:agent	ThreadContextAttachFailed	judgement
V1 error	ThreadDeleteConflictError	class	packages/agent/src/thread/ThreadAggregate.ts:83	pkg:agent	ThreadDeleteConflict	judgement
V1 error	ThreadDeleteStillSettlingError	class	packages/agent/src/thread/ThreadAggregate.ts:98	pkg:agent	ThreadDeleteRefused (reason still-settling)	judgement
V1 error	ThreadNoOutputError	class	packages/agent/src/thread/ThreadFailure.ts:14	pkg:agent	ThreadOutputMissing	judgement
V1 error	AgentProfileUnknownError	class	packages/agent/src/thread/agents/AgentProfile.ts:79	pkg:agent	AgentProfileMissing	judgement
V1 error	ThreadSummarizerWindowError	class	packages/agent/src/thread/compaction/summarizerFailure.ts:5	pkg:agent	SummarizerWindowRefused	judgement
V1 error	ThreadInteractionConflictError	class	packages/agent/src/thread/run/ThreadQuestion.ts:24	pkg:agent	ThreadInteractionConflict	judgement
V1 error	ThreadContextConflictError	class	packages/agent/src/thread/run/ThreadRunContexts.ts:29	pkg:agent	ThreadContextConflict	judgement
V1 error	ThreadSignalConflictError	class	packages/agent/src/thread/run/ThreadSignals.ts:46	pkg:agent	ThreadDeliveryConflict	judgement
V1 error	ThreadRunHeldError	class	packages/agent/src/thread/run/runAdmission.ts:3	pkg:agent	ThreadRunRefused (reason held)	judgement
V1 error	ThreadNotFoundError	class	packages/agent/src/thread/storage/aggregate.ts:88	pkg:agent	ThreadMissing	judgement
V1 error	ThreadCompactionConflictError	class	packages/agent/src/thread/storage/compaction.ts:41	pkg:agent	ThreadCompactionConflict	judgement
V1 error	ThreadCompactionExhaustedError	class	packages/agent/src/thread/storage/compaction.ts:52	pkg:agent	ThreadCompactionRefused (reason exhausted)	judgement
V1 error	ThreadNoSummarizerError	class	packages/agent/src/thread/storage/compaction.ts:63	pkg:agent	SummarizerMissing	judgement
V1 error	ThreadOwnerRuleConflictError	class	packages/agent/src/thread/storage/ownerSettings.ts:18	pkg:agent	PermissionRuleConflict	judgement
V1 error	ThreadRunNotInterruptedError	class	packages/agent/src/thread/storage/runs.ts:165	pkg:agent	ThreadRunRefused (reason not-interrupted)	judgement
V1 error	ThreadRunConflictError	class	packages/agent/src/thread/storage/runs.ts:182	pkg:agent	ThreadRunConflict	judgement
V1 error	WorkflowUnknownError	class	packages/agent/src/workflow/library.ts:24	pkg:agent	WorkflowMissing	judgement
V1 error	WorkflowCompileError	class	packages/agent/src/workflow/plan.ts:17	pkg:agent	WorkflowInvalid	judgement
V1 error	WorkflowArgumentsError	class	packages/agent/src/workflow/run.ts:38	pkg:agent	WorkflowInputInvalid	judgement
V1 error	CeilingException	value	packages/executions/src/protocol/command.ts:96	pkg:executions	CeilingExemption (not a failure)	judgement
V1 error	UnknownRungError	class	packages/layer/src/App.ts:106	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	RungClosedError	class	packages/layer/src/App.ts:91	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	DeferredServiceError	class	packages/layer/src/Graph.ts:110	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	KeyIdCollisionError	class	packages/layer/src/Graph.ts:38	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	DuplicateProviderError	class	packages/layer/src/Graph.ts:45	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	DependencyCycleError	class	packages/layer/src/Graph.ts:51	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	TierMismatchError	class	packages/layer/src/Graph.ts:57	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	UnknownTierError	class	packages/layer/src/Graph.ts:67	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	LayerTierError	class	packages/layer/src/Graph.ts:77	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	UnknownServiceError	class	packages/layer/src/Graph.ts:87	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	MissingRecipeError	class	packages/layer/src/Graph.ts:93	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	ServiceStartError	class	packages/layer/src/Graph.ts:99	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	FinalizerError	class	packages/layer/src/Scope.ts:13	pkg:layer	(condition word: see §4.2 list)	judgement
V1 error	ConfigError	class	packages/layer/src/config.ts:15	pkg:layer	(condition word: see §4.2 list)	judgement
V1 failure class	CapabilityPrepareFailure	class	apps/tagma/server/src/harness/capabilities/Capability.ts:33	server	CapabilityPrepareFailed	
V1 failure class	PipeSpawnFailure	class	packages/execution-host/src/PipeProcess.ts:29	pkg:execution-host	PipeSpawnFailed	
V1 failure class	PipeStopFailure	class	packages/execution-host/src/PipeProcess.ts:33	pkg:execution-host	PipeStopFailed	
V1 failure class	PipeWriteFailure	class	packages/execution-host/src/PipeStdin.ts:25	pkg:execution-host	PipeWriteFailed	
V1 failure class	PipeReadFailure	class	packages/execution-host/src/native/PipeChild.ts:10	pkg:execution-host	PipeReadFailed	
V1 failure class	PipeExitFailure	class	packages/execution-host/src/native/PipeChild.ts:15	pkg:execution-host	PipeExitFailed	
V1 failure class	PtySpawnFailure	class	packages/execution-host/src/native/Pty.ts:17	pkg:execution-host	PtySpawnFailed	
V1 failure class	PtyReadFailure	class	packages/execution-host/src/native/Pty.ts:22	pkg:execution-host	PtyReadFailed	
V1 failure class	PtyWriteFailure	class	packages/execution-host/src/native/Pty.ts:27	pkg:execution-host	PtyWriteFailed	
V1 failure class	PtyWaitFailure	class	packages/execution-host/src/native/Pty.ts:32	pkg:execution-host	PtyWaitFailed	
V1 failure class	PtySignalFailure	class	packages/execution-host/src/native/Pty.ts:36	pkg:execution-host	PtySignalFailed	
V1 failure class	PtyResizeFailure	class	packages/execution-host/src/native/Pty.ts:42	pkg:execution-host	PtyResizeFailed	
V1 failure class	PtyTerminalFailure	class	packages/execution-host/src/native/Pty.ts:47	pkg:execution-host	PtyTerminalFailed	
V1 failure class	PtyStopFailure	class	packages/execution-host/src/native/Pty.ts:52	pkg:execution-host	PtyStopFailed	
V1 failure class	ManagedCallFailure	class	packages/executions/src/ManagedCall.ts:11	pkg:executions	ManagedCallFailed	
V1 failure class	Failure	class	packages/layer/src/Failure.ts:4	pkg:layer	(keeps: a layer-package service, outside the glossary)	
V1 failure union	HarnessFailed	type	apps/tagma/server/src/harness/refusal.ts:19	server	HarnessFailure	
V1 failure union	ThreadFailed	type	apps/tagma/server/src/harness/refusal.ts:52	server	ThreadFailure	
V1 failure union	ThreadBorderFailed	type	packages/agent/src/thread/ThreadBorder.ts:57	pkg:agent	ThreadBorderFailure	
V2 outcome	ReviewOutcome	type	apps/tagma/server/src/cli/reviewLaunch.ts:35	server	ReviewEnding	judgement
V2 outcome	TreeCommitOutcome	type	apps/tagma/server/src/files/TreeCommits.ts:28	server	SyncAnswer	judgement
V2 outcome	FreshnessOutcome	type	apps/tagma/server/src/files/freshness.ts:77	server	FreshnessStatus	judgement
V2 outcome	OpOutcome	type	apps/tagma/server/src/graph/work/Amendments.ts:30	server	OpAnswer	judgement
V2 outcome	CommandSignalOutcome	type	apps/tagma/server/src/harness/CommandDelivery.ts:13	server	CommandDeliveryAnswer	judgement
V2 outcome	ThreadOutcome	type	apps/tagma/server/src/harness/ThreadStore.ts:117	server	RunEnding	judgement
V2 outcome	EnvironmentUseOutcome	value	apps/tagma/server/src/protocol/environments.ts:56	server	EnvironmentUseStatus	judgement
V2 outcome	ThreadRolloutRepairOutcome	type	apps/tagma/server/src/protocol/evidence.ts:243	server	RolloutRepairStatus	judgement
V2 outcome	PrepareOutcome	type	apps/tagma/server/src/protocol/harness/adapter.ts:64	server	PrepareAnswer	judgement
V2 outcome	HarnessOutcome	type	apps/tagma/server/src/protocol/harness/call.ts:44	server	HarnessAnswer (today's HarnessAnswer → SettledHarnessAnswer)	judgement
V2 outcome	ThreadInstructionOutcome	type	apps/tagma/server/src/protocol/threadInstructions.ts:7	server	InstructionStatus	judgement
V2 outcome	ThreadTitleOutcome	type	apps/tagma/server/src/protocol/threadTitle.ts:8	server	TitleStatus	judgement
V2 outcome	AgentToolOutcome	type	packages/agent/src/agent/AgentToolDoor.ts:100	pkg:agent	ToolCallAnswer (two declarations: S4)	judgement
V2 outcome	AgentToolOutcome	type	packages/agent/src/agent/turn/tools.ts:28	pkg:agent	ToolCallAnswer (two declarations: S4)	judgement
V2 outcome	PermissionOutcome	type	packages/agent/src/permissions/index.ts:142	pkg:agent	PermissionRuling	judgement
V2 outcome	ThreadDrainOutcome	type	packages/agent/src/thread/run/ThreadDrain.ts:15	pkg:agent	DrainEnding	judgement
V2 outcome	ThreadToolOutcome	type	packages/agent/src/thread/run/ThreadToolRecords.ts:14	pkg:agent	ToolCallAnswer	judgement
V2 outcome	ReplyOutcome	type	packages/execution-host/src/ExecutionInput.ts:80	pkg:execution-host	ReplyAnswer	judgement
V2 outcome	SealOutcome	type	packages/execution-host/src/ExecutionRecord.ts:156	pkg:execution-host	SealAnswer	judgement
V2 outcome	ForgetOutcome	type	packages/execution-host/src/ExecutionRegistry.ts:283	pkg:execution-host	ForgetAnswer	judgement
V2 outcome	RefreshOutcome	type	packages/execution-host/src/ProvenSet.ts:109	pkg:execution-host	RefreshStatus	judgement
V2 outcome	RevisionOutcome	value	packages/execution-host/src/db/persisted.ts:103	pkg:execution-host	RevisionStatus	judgement
V2 outcome	CommandRevisionOutcome	value	packages/executions/src/protocol/command.ts:131	pkg:executions	CommandRevisionAnswer	judgement
V2 outcome	CustodyOutcome	value	packages/executions/src/protocol/control.ts:32	pkg:executions	CustodyAnswer	judgement
V2 outcome	InputOutcome	value	packages/executions/src/protocol/input.ts:53	pkg:executions	InputAnswer	judgement
V2 outcome	StartOutcome	value	packages/executions/src/protocol/launch.ts:59	pkg:executions	StartAnswer	judgement
V2 outcome	CancelOutcome	value	packages/executions/src/protocol/launch.ts:80	pkg:executions	CancelAnswer	judgement
V2 outcome	PaintOutcome	type	packages/executions/src/protocol/presentationPaint.ts:25	pkg:executions	PaintAnswer	judgement
V2 outcome	ResumeOutcome	value	packages/executions/src/protocol/runtime.ts:100	pkg:executions	ResumeAnswer	judgement
V2 outcome	QuiescenceOutcome	value	packages/executions/src/protocol/runtime.ts:88	pkg:executions	QuiescenceAnswer	judgement
V2 outcome	SignalOutcome	value	packages/executions/src/protocol/stop.ts:126	pkg:executions	SignalAnswer	judgement
V2 outcome	ShutdownOutcome	value	packages/executions/src/protocol/stop.ts:138	pkg:executions	ShutdownAnswer	judgement
V2 outcome	StreamOutcome	value	packages/executions/src/protocol/stop.ts:92	pkg:executions	StreamEnding (merge with the field type)	judgement
V2 outcome	AuthorityOutcome	value	packages/executions/src/protocol/wire.ts:138	pkg:executions	AuthorityAnswer	judgement
V2 outcome	RetireOutcome	value	packages/executions/src/protocol/wire.ts:155	pkg:executions	RetireAnswer	judgement
V2 response	InspectionReply	type	apps/tagma/server/src/enforcement/asks.ts:33	server	InspectionAnswer	vendor/HTTP payloads exempt
V2 response	MeasureReply	type	apps/tagma/server/src/graph/measure/measureThread.ts:42	server	MeasureAnswer	vendor/HTTP payloads exempt
V2 response	PdfReply	type	packages/agent-tools/src/pdf.ts:35	pkg:agent-tools	PdfAnswer	vendor/HTTP payloads exempt
V2 response	Response	value	packages/executions/src/protocol/wire.ts:225	pkg:executions	Answer (host wire frame; type name only)	vendor/HTTP payloads exempt
V2 response	StoreResponse	type	packages/performance/src/PerformanceStore.ts:215	pkg:performance	StoreAnswer	vendor/HTTP payloads exempt
V2 result	GraphFileSyncResult	type	apps/tagma/server/src/files/GraphFileSync.ts:116	server	GraphFileSyncAnswer	Effect Result collides
V2 result	BatchResult	type	apps/tagma/server/src/graph/work/Amendments.ts:37	server	BatchAnswer	Effect Result collides
V2 result	EvidenceResult	type	apps/tagma/server/src/harness/EvidenceReads.ts:102	server	EvidenceAnswer	Effect Result collides
V2 result	PrepareRootResult	type	apps/tagma/server/src/harness/prepareRoot.ts:20	server	PrepareRootAnswer	Effect Result collides
V2 result	SessionToolResult	type	apps/tagma/server/src/protocol/evidence.ts:439	server	SessionToolAnswer (S2)	Effect Result collides
V2 result	SarifResult	value	apps/tagma/server/src/protocol/inspectionProgram.ts:108	server	SarifAnswer	Effect Result collides
V2 result	ReadinessResult	value	apps/tagma/server/src/protocol/preparedTree.ts:35	server	ReadinessAnswer	Effect Result collides
V2 result	ThreadTitleResult	type	apps/tagma/server/src/protocol/threadTitle.ts:39	server	ThreadTitleAnswer	Effect Result collides
V2 result	GraphToolResult	type	apps/tagma/server/src/protocol/toolResult.ts:264	server	GraphToolAnswer (S2)	Effect Result collides
V2 result	ToolBlockResult	type	apps/tagma/server/src/protocol/toolResult.ts:60	server	ToolBlockAnswer (S2)	Effect Result collides
V2 result	RuledResult	type	packages/agent-tools/src/CommandWork.ts:23	pkg:agent-tools	RuledAnswer	Effect Result collides
V2 result	ToolSearchResult	type	packages/agent/src/agent/AgentDeferredTools.ts:11	pkg:agent	ToolSearchAnswer	Effect Result collides
V2 result	AgentSkillLoadResult	type	packages/agent/src/agent/AgentSkill.ts:23	pkg:agent	AgentSkillLoadAnswer	Effect Result collides
V2 result	AgentStepToolResult	type	packages/agent/src/agent/AgentStep.ts:26	pkg:agent	AgentStepToolAnswer	Effect Result collides
V2 result	CallControlResult	value	packages/agent/src/agent/callProgress.ts:14	pkg:agent	CallControlAnswer	Effect Result collides
V2 result	ThreadWaitResult	type	packages/agent/src/collaboration/ThreadEnvelopes.ts:84	pkg:agent	ThreadWaitAnswer	Effect Result collides
V2 result	ThreadSpawnResult	type	packages/agent/src/collaboration/ThreadPlaneAccess.ts:15	pkg:agent	ThreadSpawnAnswer	Effect Result collides
V2 result	ThreadCompactionResult	type	packages/agent/src/thread/compaction/ThreadCompaction.ts:154	pkg:agent	ThreadCompactionAnswer	Effect Result collides
V2 result	ThreadHistoryCompactionResult	type	packages/agent/src/thread/compaction/ThreadCompaction.ts:184	pkg:agent	ThreadHistoryCompactionAnswer	Effect Result collides
V2 result	ThreadManualCompactionResult	type	packages/agent/src/thread/compaction/ThreadCompaction.ts:207	pkg:agent	ThreadManualCompactionAnswer	Effect Result collides
V2 result	ThreadEffectSettlementResult	type	packages/agent/src/thread/run/ThreadEffectSettlement.ts:22	pkg:agent	ThreadEffectSettlementAnswer	Effect Result collides
V2 result	ThreadSignalEnqueueResult	type	packages/agent/src/thread/run/ThreadRunInbox.ts:23	pkg:agent	DeliveryEnqueueAnswer (Q4)	Effect Result collides
V2 result	ThreadSignalResult	type	packages/agent/src/thread/run/ThreadSignals.ts:38	pkg:agent	ThreadDeliveryAnswer (Q4)	Effect Result collides
V2 result	ThreadSpeakResult	type	packages/agent/src/thread/run/ThreadSignals.ts:78	pkg:agent	ThreadSpeakAnswer	Effect Result collides
V2 result	ThreadSteerResult	type	packages/agent/src/thread/run/ThreadSignals.ts:83	pkg:agent	ThreadSteerAnswer	Effect Result collides
V2 result	ThreadStreamToolResult	type	packages/agent/src/thread/run/ThreadStreamPump.ts:33	pkg:agent	ThreadStreamToolAnswer	Effect Result collides
V2 result	ThreadStreamQuestionResult	type	packages/agent/src/thread/run/ThreadStreamPump.ts:35	pkg:agent	ThreadStreamQuestionAnswer	Effect Result collides
V2 result	ThreadKeepWarmResult	type	packages/agent/src/thread/run/ThreadTurnRunner.ts:111	pkg:agent	ThreadKeepWarmAnswer	Effect Result collides
V2 result	ToolQuestionResult	type	packages/agent/src/thread/run/ToolQuestion.ts:42	pkg:agent	ToolQuestionAnswer	Effect Result collides
V2 result	ThreadRunReapResult	type	packages/agent/src/thread/storage/runs.ts:61	pkg:agent	ThreadRunReapAnswer	Effect Result collides
V2 result	UserQuestionAnswerResult	type	packages/agent/src/tools/UserQuestion.ts:51	pkg:agent	UserQuestionAnswer	Effect Result collides
V2 result	CallResult	value	packages/executions/src/protocol/call.ts:83	pkg:executions	CallAnswer	Effect Result collides
V2 result	GitResult	type	packages/git/src/Git.ts:14	pkg:git	GitAnswer	Effect Result collides
V3 ask	JudgeAsk	type	apps/tagma/server/src/enforcement/asks.ts:15	server	JudgeRequest	judgement
V3 ask	InspectionAsk	type	apps/tagma/server/src/enforcement/asks.ts:27	server	InspectionRequest	judgement
V3 ask	ReachAsk	type	apps/tagma/server/src/enforcement/asks.ts:4	server	ReachRequest	judgement
V3 ask	CheckAsk	type	apps/tagma/server/src/enforcement/check.ts:42	server	CheckInput	judgement
V3 ask	EnforceAsk	type	apps/tagma/server/src/enforcement/enforce.ts:34	server	EnforceInput	judgement
V3 ask	ProgramAsk	type	apps/tagma/server/src/enforcement/programs.ts:27	server	ProgramRequest	judgement
V3 ask	MeasureAsk	type	apps/tagma/server/src/graph/measure/measureThread.ts:38	server	MeasureRequest	judgement
V3 ask	EvidenceAsk	type	apps/tagma/server/src/harness/EvidenceReads.ts:54	server	EvidenceQuery	judgement
V3 ask	HarnessAdoptionAsk	type	apps/tagma/server/src/harness/HarnessSessionStore.ts:17	server	AdoptionRequest	judgement
V3 ask	PlacementAsk	type	apps/tagma/server/src/harness/ThreadPlacement.ts:29	server	PlacementInput	judgement
V3 ask	ThreadAsk	type	apps/tagma/server/src/harness/protocol.ts:56	server	ThreadAsk (S2; keeps ask)	judgement
V3 ask	GuestAsk	type	apps/tagma/server/src/harness/sandbox/docker/guestWire.ts:4	server	GuestRequest	judgement
V3 ask	RestartAsk	type	apps/tagma/server/src/http/succession.ts:42	server	RestartInput	judgement
V3 ask	HarnessScreenAsk	type	apps/tagma/server/src/protocol/harness/adapter.ts:136	server	ScreenAsk (keeps ask: a question on a CLI screen)	judgement
V3 ask	RpcAsk	type	apps/tagma/server/src/protocol/harness/adapter.ts:59	server	RpcRequest	judgement
V3 ask	ThreadAsk	type	apps/tagma/server/src/thread/pendingAsk.ts:8	server	ThreadAsk (keeps ask)	judgement
V3 ask	MergeAsk	type	apps/tagma/server/src/working/PendingMerges.ts:27	server	MergeRequest	judgement
V3 ask	PdfAsk	type	packages/agent-tools/src/pdf.ts:7	pkg:agent-tools	PdfRequest	judgement
V3 ask	ThreadModelAsk	type	packages/agent/src/collaboration/ThreadPlaneAccess.ts:59	pkg:agent	ModelSelection	judgement
V3 ask	ThreadCompactAsk	type	packages/agent/src/thread/compaction/ThreadCompactionRuns.ts:72	pkg:agent	CompactInput	judgement
V3 ask	ThreadSummarizerAsk	type	packages/agent/src/thread/compaction/summarizer.ts:29	pkg:agent	SummarizerRequest	judgement
V3 ask	ThreadContextAsk	type	packages/agent/src/thread/run/ThreadRunContexts.ts:18	pkg:agent	ContextRequest	judgement
V3 ask	CommandRevisionAsk	value	packages/execution-host/src/db/persisted.ts:86	pkg:execution-host	CommandRevisionRequest	judgement
V3 params	ThreadChatCommandParams	type	packages/agent/src/protocol/realtime.ts:154	pkg:agent	ThreadChatCommandInput	
V4 listing	CommandListing	value	apps/tagma/server/src/protocol/commandReads.ts:67	server	CommandRow	
V4 listing	CommandRuleListing	value	apps/tagma/server/src/protocol/commandRules.ts:55	server	CommandRuleRow	
V4 listing	StoresListing	value	apps/tagma/server/src/protocol/repositories.ts:59	server	StoreRow	
V4 listing	TerminalListing	value	apps/tagma/server/src/protocol/terminals.ts:310	server	TerminalRow	
V4 listing	WorktreeListing	value	apps/tagma/server/src/protocol/worktrees.ts:315	server	WorktreeRow	
V4 listing	WorktreeListing	class	apps/tagma/server/src/worktrees/WorktreeListing.ts:93	server	WorktreeRow	
V5 standing	RolloutStanding	type	apps/tagma/server/src/files/rolloutForms.ts:12	server	RolloutState	section 5 already decided
V5 standing	KeepWarmStanding	type	apps/tagma/server/src/harness/KeepWarmReads.ts:16	server	KeepWarmState	section 5 already decided
V5 standing	ThreadStanding	type	apps/tagma/server/src/harness/ThreadStore.ts:85	server	ThreadState (S2)	section 5 already decided
V5 standing	JobStanding	type	apps/tagma/server/src/harness/shellJob.ts:8	server	JobState	section 5 already decided
V5 standing	Standing	type	apps/tagma/server/src/install/standing.ts:5	server	InstallationState	section 5 already decided
V5 standing	RootStanding	value	apps/tagma/server/src/protocol/assignments.ts:36	server	RootState	section 5 already decided
V5 standing	ThreadFileStanding	value	apps/tagma/server/src/protocol/checkoutStatus.ts:99	server	ThreadFileState	section 5 already decided
V5 standing	MachineStanding	type	apps/tagma/server/src/protocol/machineStanding.ts:137	server	MachineState	section 5 already decided
V5 standing	CheckoutStanding	type	apps/tagma/server/src/protocol/machineStanding.ts:41	server	CheckoutState	section 5 already decided
V5 standing	AwakeStanding	type	apps/tagma/server/src/protocol/power.ts:21	server	AwakeState	section 5 already decided
V5 standing	PaceStanding	type	apps/tagma/server/src/protocol/power.ts:44	server	PaceState	section 5 already decided
V5 standing	RepositoryStanding	type	apps/tagma/server/src/protocol/repositories.ts:33	server	RepositoryState	section 5 already decided
V5 standing	ThreadStanding	type	apps/tagma/server/src/socket/changesChannel.ts:12	server	ThreadState	section 5 already decided
V5 standing	CommandStanding	type	apps/tagma/server/src/terminals/TerminalStore.ts:139	server	CommandState	section 5 already decided
V5 standing	PreflightStanding	type	apps/tagma/server/src/terminals/hostPreflight.ts:14	server	PreflightState	section 5 already decided
V5 standing	HostStanding	type	apps/tagma/server/src/terminals/hostReplacement.ts:48	server	HostState	section 5 already decided
V5 standing	TerminalStanding	type	apps/tagma/server/src/terminals/terminalPolicy.ts:33	server	TerminalState	section 5 already decided
V5 standing	ThreadStanding	type	apps/tagma/server/src/working/Assignments.ts:15	server	ThreadState	section 5 already decided
V5 standing	ThreadPruningStanding	type	packages/agent/src/thread/composition/requestComposition.ts:28	pkg:agent	ThreadPruningState	section 5 already decided
V5 standing	ThreadContextStanding	type	packages/agent/src/thread/run/ThreadRunContexts.ts:73	pkg:agent	ThreadContextState	section 5 already decided
V5 standing	CustodyStanding	type	packages/execution-host/src/Custodian.ts:69	pkg:execution-host	CustodyState	section 5 already decided
V5 standing	CapacityStanding	type	packages/execution-host/src/ExecutionCapacity.ts:127	pkg:execution-host	CapacityState	section 5 already decided
V5 standing	ResidualStanding	type	packages/execution-host/src/ProvenSet.ts:252	pkg:execution-host	ResidualState	section 5 already decided
V5 standing	PidStanding	type	packages/execution-host/src/strayProcesses.ts:11	pkg:execution-host	PidState	section 5 already decided
V5 standing	HostStanding	type	packages/executions/src/HostLauncher.ts:15	pkg:executions	HostState	section 5 already decided
V5 standing	PlatformStanding	type	packages/executions/src/protocol/capacity.ts:74	pkg:executions	PlatformState	section 5 already decided
V6 config	AgentConfig	type	packages/agent/src/agent/Agent.ts:6	pkg:agent	AgentConfig (keeps: construction values)	judgement
V6 config	CollaborationConfig	type	packages/agent/src/collaboration/CollaborationConfig.ts:52	pkg:agent	CollaborationConfig (keeps: declared in a definition)	judgement
V6 config	PromiseAgentHarnessConfig	type	packages/agent/src/promise/index.ts:101	pkg:agent	(keeps)	judgement
V6 config	PromiseResourcesConfig	type	packages/agent/src/promise/index.ts:145	pkg:agent	(keeps)	judgement
V6 config	ResourcesConfig	type	packages/agent/src/resources/ResourcesConfig.ts:16	pkg:agent	(keeps)	judgement
V6 config	AgentHarnessConfig	type	packages/agent/src/thread/AgentHarness.ts:136	pkg:agent	(keeps)	judgement
V6 config	ThreadHostConfig	class	packages/agent/src/thread/ThreadPorts.ts:346	pkg:agent	ThreadHostConfig (keeps)	judgement
V6 config	WorkflowConfig	type	packages/agent/src/workflow/WorkflowConfig.ts:20	pkg:agent	(keeps)	judgement
V6 config	Config	value	packages/layer/src/config.ts:192	pkg:layer	(layer: its own vocabulary)	judgement
V6 config	Config	class	packages/layer/src/svelte/test-utils/deferred-fixtures.ts:14	pkg:layer	(layer: its own vocabulary)	judgement
V6 config	Config	class	packages/layer/src/svelte/test-utils/screen-fixtures.svelte.ts:5	pkg:layer	(layer: its own vocabulary)	judgement
V7 harness(test)	ThreadResourceLedgerHarness	type	packages/agent/src/thread/conformance/resources.ts:9	pkg:agent	ThreadResourceLedgerRig	test rig
V7 harness(test)	ThreadStorageHarness	type	packages/agent/src/thread/conformance/storagePort.ts:26	pkg:agent	ThreadStorageRig	test rig
V7 harness(test)	WorkflowRunStorageHarness	type	packages/agent/src/workflow/conformance.ts:9	pkg:agent	WorkflowRunStorageRig	test rig
V7 harness(test)	HostConformanceHarness	type	packages/executions/src/conformance/hostConformance.ts:12	pkg:executions	HostConformanceRig	test rig
V8 signal	AgentSignal	type	packages/agent/src/agent/contracts.ts:38	pkg:agent	AgentDelivery (Q4)	judgement
V8 signal	ThreadSignal	type	packages/agent/src/transcript/parts.ts:18	pkg:agent	ThreadDelivery (Q4)	judgement
V8 update	ThreadAtomicUpdate	type	apps/tagma/server/src/thread/ThreadStore.ts:41	server	ThreadWrite	judgement
V8 update	ThreadAtomicUpdate	type	packages/agent/src/thread/storage/aggregate.ts:78	pkg:agent	ThreadWrite	judgement
V8 update	InventoryUpdate	value	packages/executions/src/protocol/inventory.ts:59	pkg:executions	InventoryDelta (or snapshot | delta)	judgement
V8 update	ScreenUpdate	value	packages/executions/src/protocol/presentation.ts:204	pkg:executions	ScreenDelta (or snapshot | delta)	judgement
V9 origin	InstallationOrigin	value	apps/tagma/server/src/install/closure.ts:89	server	InstallationProvenance	amends section 5 "source"
V9 origin	CommandIntentOrigin	value	apps/tagma/server/src/protocol/commandPolicy.ts:121	server	IntentProvenance	amends section 5 "source"
V9 origin	CommandRuleOrigin	value	apps/tagma/server/src/protocol/commandRules.ts:25	server	CommandRuleProvenance	amends section 5 "source"
V9 origin	RootOrigin	value	apps/tagma/server/src/protocol/projectRoots.ts:7	server	ProjectRootKind	amends section 5 "source"
V9 origin	NameOrigin	type	apps/tagma/server/src/protocol/threadName.ts:42	server	NameProvenance	amends section 5 "source"
V9 origin	ThreadTitleOrigin	type	apps/tagma/server/src/protocol/threadTitle.ts:5	server	TitleProvenance	amends section 5 "source"
V9 origin	WorkOrigin	value	apps/tagma/server/src/protocol/workingOrigin.ts:14	server	WorkOrigin (keeps: an arm of the working origin)	amends section 5 "source"
V9 origin	GraphOrigin	value	apps/tagma/server/src/protocol/workingOrigin.ts:48	server	GraphOrigin (keeps: an arm of the working origin)	amends section 5 "source"
V9 origin	CommandTimeOrigin	type	packages/agent-tools/src/CommandWork.ts:81	pkg:agent-tools	LimitProvenance	amends section 5 "source"
V9 origin	WorkspaceChangeOrigin	type	packages/agent-tools/src/WorkspaceChanges.ts:4	pkg:agent-tools	WriteProvenance	amends section 5 "source"
V9 origin	AgentMessageOrigin	type	packages/agent/src/agent/AgentSignal.ts:9	pkg:agent	MessageProvenance	amends section 5 "source"
V9 origin	CommandOrigin	value	packages/executions/src/protocol/command.ts:17	pkg:executions	CommandProvenance	amends section 5 "source"
V9 origin	CommandTimeOrigin	value	packages/executions/src/protocol/command.ts:24	pkg:executions	LimitProvenance	amends section 5 "source"
```
