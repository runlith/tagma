---
id: 01a0e45e-ddc1-7428-b814-cc17439f444e
title: "Draft: target architecture of the agent kernel — owned lifetimes, durable transitions and explicit ports"
ord: 22
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
# Draft: target architecture of the agent kernel

The proposed kernel is a reusable, Effect-native execution mechanism with explicit ownership of durable transitions, live work and recovery. Products supply policy, storage, model deployment, tools and execution worlds. Native threads, externally driven collaborators and workflow members share only the contracts they actually implement. A stopped or failed call never claims an effect did not happen without evidence; an accepted act never disappears behind a failed publication.

This is an **idea for acceptance**, jointly designed by `astra-kernel` and `astra-model`, not an implemented guarantee or an amendment already applied. The baseline is [[5610ee2b|the accompanying source review]]. No code, tests, typechecks, database reads, paid calls or load experiments were run. “10/10” is the acceptance standard below, not a measured score.

## 1. Scope and standing decisions

The primary owner is [[d1caad35|the agent kernel]]. The model boundary belongs jointly with [[249ce587|the model-wire package]], and built-in workspace tooling with [[5565be05|the agent-tools package]]. MCP and workspace-source discovery are covered only where their contracts meet the kernel.

The draft builds on these accepted sections and changes none silently:

- [[be799808|Section 6: package ownership, entry roles and platform boundaries]].
- [[9c085c6c|Section 3.13: prepared, keyed transitions and performance]].
- [[f658e190|Section 1: the common harness concept and product modules]].
- [[70083b67|Section 2: data ownership and coordinated units]].
- [[243fd181|Section 5: names]].

Section 6's separation of `paging`, explicit worlds, product-owned wording and versioned stored forms stands. Tagma's journal/export/rest/wake lane remains owned by `threads`; `native-harness` owns its run and fold adapter; `providers` owns account and spend policy. The kernel acquires no SQL driver, filesystem, process host, MCP client, vendor SDK or Tagma operation catalog.

Exact proposed corrections to accepted text are in §12. Until accepted, the original decisions stand and the listed contradictions are implementation blockers.

## 2. Observable outcome

A product can compose the turn loop alone, the persistent native runtime, or the persistent runtime with independently declared collaboration, workflows and resources. Each composition has one scoped startup/shutdown owner, known capabilities and diagnostics. No missing capability silently becomes the host machine or native driver.

Across a lost answer, process restart, competing driver, cancelled tool, failed publication and stale prepared fold, the answer distinguishes **not accepted**, **accepted and pending**, **committed**, **replayed**, **refused**, **spent**, and **uncertain** at the boundary that can establish it. Recovery uses the same identities as the original act. It never reruns an unknown external mutation merely to make the transcript complete.

The package's direction check measures the owners below, including type dependencies and browser reach. Passing an export-count target or splitting large files does not satisfy this outcome.

## 3. Owners and dependency direction

These are internal boundaries in one package, not a request for a package per row. Existing cohesive files stay cohesive. The final entry-path move is one consumer migration, after the contracts settle.

| Owner | Owns; changes when | May depend on |
|---|---|---|
| Vocabulary and pure models | Owner-local identities, messages, event/entry forms, permission declarations, state transitions, deterministic folds and query grammar; changes when meaning or a carried format changes | Stable `llm` call vocabulary and generic primitives only |
| Model-call boundary | The kernel's model request/attempt contract and adaptation into `llm`; changes when call capabilities, cancellation, retry or accounting evidence change | Kernel model contract; `llm` call/runtime entries in its adapter only |
| Turn loop | One in-memory run, steps, guidance, offered/admitted tools and result pairing; changes when a step's execution rules change | Vocabulary, permission decision, model port, tool door; no durable thread or wire |
| Tool door | Admission, immutable prepared subjects, approval, call lifetime and effect outcome; changes when a call may start or how it is stopped/recovered | Tool/permission contracts, scoped call services and injected host ports; no product policy |
| Thread state and journal transition | Native aggregate state, event interpretation, history/transcript delta application, birth seed and keyed persistence protocol; changes when durable thread invariants change | Pure folds and storage/unit ports; no native turn runner, collaboration, wire or product |
| Context | Request identity and measurement, prompt composition, pruning, compaction plans and settlements, cache observations; changes when the request a model sees is reduced or priced | Message/fold contracts, context stores, model port; no run driver or wire |
| Native run machine | Admission, lease/fence, episode scope, recording, questions, inbox delivery, ending and recovery; changes when a native run's durable lifecycle changes | Thread state, context, loop and its storage/host ports |
| Native thread commands | The native implementation of command coordination for send/queue/steer/continue/compact/answer/delete; changes when these commands coordinate native lifecycles | Native run machine and lower thread owners; no optional plane implementation or wire. Common collaboration consumes the runtime contract, never this facade |
| Evidence and feed | Consistent pinned reads, bounded queries, snapshot/resume semantics and live projection; changes when a reader's evidence or continuity contract changes | Read ports and pure transcript/query folds; no command driver |
| Collaboration | Lineage, rights, child admission, envelopes, obligations and report delivery; changes when agents act on one another | Required common catalog/runtime ports, inbox and budget/resource contracts; no native stores or runner |
| Workflow | Validated plan, bounded dispatch, durable step ledger, driver lease, finish/cancel/recovery; changes when a composition of member runs advances | Workflow store and member executor; collaboration is one supplied executor, not an imported fallback |
| Resources | A thread's durable holdings and release obligations; changes when ownership or release evidence changes | Resource store and registered kind contracts; no product resource implementation |
| Harness composition | Acquiring and connecting the selected owners, startup and ordered shutdown; changes when a product selects a composition | Ready owner constructors/layers and contribution contracts; no policy decisions |
| Wire, promise and testing surfaces | Encoding/decoding, language adaptation and executable port contracts, respectively | Their explicit public owner contracts; no lower owner imports these surfaces |

The dependency graph is a partial order. Context selection, pairing, transcript placement, identity and codecs are placed below every owner that needs them, rather than leaving an upward import as “debt.” For example, provider-pair repair leaves `thread/run/toolPairing.ts` for its pure message owner; resume selection leaves `protocol/resume.ts` for the evidence owner; page-family budgets live with the reader that owns the answer. The wire only encodes that result.

`ThreadAggregate` does not remain a generic name for all these responsibilities. Its persistent state behavior stays below the run machine; its command coordination moves above it; evidence leaves for the reader owner. `AgentHarness` becomes scoped composition plus a deliberate application facade, rather than the place new capabilities accumulate. This is an ownership cut, not a mandatory one-method service per verb.

Ports are complete contracts owned by their consumer, with named real fillers. Dependencies enter owners as individual constructor parameters or typed Effect services; the final options object holds optional values only. No `Pick`-shaped dependency, cast-based transaction adaptation, generic service locator or forwarding barrel is introduced.

## 4. Product composition and optional capabilities

### 4.1 Three supported compositions

1. **Loop-only:** caller-owned context and tool/model capabilities; no durable replay promise. Cancellation still reports uncertain effects honestly.
2. **Persistent native runtime:** thread/journal/run/inbox/output/attachment ports, context and explicit policy; owns native recovery.
3. **Declared optional capabilities:** collaboration, workflows and resources connect through their public contracts. An omitted capability creates no hidden implementation, reconciliation fiber, tool or prompt section. Existing no-op adapters remain only where they represent a meaningful optional contract, not to conceal a required runtime.

The startup constructor validates configuration at the composition boundary, resolves the service graph once and returns a disposable/scoped handle. It admits no work until stores have migrated, old writers are fenced, required recovery is established and capabilities are known. Shutdown closes admission, requests interruption/handover, flushes required durable state, records unfinished cleanup, then releases scopes in reverse ownership order. Process-local scopes may be per product/tenant when secrets or policy differ; “one global harness” is not a portability assumption.

### 4.2 Common catalog and runtime

The collaboration kit requires `ThreadCatalog` and `ThreadRuntime`. Their declaration is kernel-owned; Tagma `threads` fills them by selecting its native or external harness. There is no optional participant map that falls back to `ThreadTurnRunner`.

The **catalog** supplies identity, principal/host binding, lineage, address uniqueness, current authority/rights, budget and a truthful execution/liveness reading. Native history, checkpoint, provider request, pending native question and native `ThreadRunRow` are not required of an external collaborator. Availability is a tagged capability, not a fabricated native-shaped row with empty fields. Catalog reads used to authorize an act are rechecked by the owning birth/delivery/control unit.

The **runtime** owns accepted delivery and controls for the selected driver: start/wake/deliver, continue, stop, answer/cancel and current execution. Every retryable command takes a stable request identity and returns its accepted/delivered/queued/refused/uncertain outcome. Controls name the expected execution identity, so an old stop cannot stop a replacement. The external implementation reports what its process/protocol proved; it does not inherit native step-replay or in-memory approval guarantees by structural typing.

The native run slot and fencing token stay in native run storage. The external session's lifecycle and custody stay in its product adapter. The common catalog exposes their projection without becoming a second authoritative run machine. Common completion carries execution identity, outcome and report evidence supplied by that driver; collaboration does not read native transcript entries to invent an external driver's answer. `cancel` means the declared pending interaction/request control, not a new synonym for stop or a promised CLI operation: unsupported drivers return a typed capability refusal.

Generic collaboration budget, lineage and obligation semantics remain in the package. Product eligibility, spend rules, model restrictions, workspace placement and wording remain in the product. Type/model menus describe offered choices, while current catalog admission happens at the act; a stale enum frozen when a run opened cannot preempt that admission.

### 4.3 Contribution points

Use fixed composition for the closed set of built-in capabilities. A tool source declares stable identity, capability admission, catalog, prompt contribution and lifetime; duplicate identity refuses composition. Resource kinds likewise reject duplicate identity and declare storage/release semantics and diagnostics. A retained row of a no-longer-installed kind is an explicit unavailable-release obligation: its owner is diagnosed and deletion remains blocked until that capability is restored or an authorized migration supplies its release; no force-drop pretends an external resource was released. Agent type catalogs resolve offered definitions at the birth boundary. A runtime registry is added only when runtime addition/removal is a real requirement; it then owns ordering, duplicate policy and unregister lifetime, not only a map.

## 5. Durable transition and recovery model

### 5.1 One event truth and one acceptance unit

Keep the accepted `transition`, `control`, `prepare`, `transitionIn`, `prepareBirth` and `birth` operations. Delta writes (`appendHistory`, `replaceHistoryPrefix`, `truncateHistory`, control-column patches and run tails) are apply primitives behind these operations, not a second public mutation route bypassing their identity/fence/version checks.

A transition follows this protocol:

1. Mint the act/run/event identities once. Capture the immutable request digest and explicit source versions. Prepare expensive folds outside every database unit and resource hold, using a consistent read snapshot and only the necessary seed/suffix.
2. Enter the product's thread journal lane where journal/fold inputs are written, then acquire the store's typed write unit. `control` that changes only inbox/control records takes no journal lane.
3. Read the act's authoritative record first. Matching identity/digest replays its actual result. A changed digest refuses. A retained tombstone answers spent. No participant runs on these paths.
4. For a new act, validate the prepared source revisions, driver fence and current control/permission predicates. A stale preparation retries outside the unit under the same absolute deadline; an invalid current permission subject refuses rather than obtaining broader consent.
5. Append the declared events and apply all derived folds, state/control patches and in-unit participants together: usage facts, inbox delivery/acknowledgement, checkpoint/prune settlement, output references and run phase. Record the authoritative outcome in that unit. Commit is the acceptance point.
6. Publish after commit. A publication failure leaves a committed result and a recoverable publication obligation; it is never returned as proof that acceptance did not occur.

The kernel defines generic keyed-transition semantics. Product record owners supply the typed first-lookup/apply participant for records they own, such as a command delivery. The shared kernel never names `command_delivery`, Tagma `ActorRef`, operation ids or graph units. A unit is opaque to the kernel and bound by its adapter to one store instance/generation and declared participants. It cannot escape its callback, cross an isolate, wait for a model/worker/network/file operation, or accept a unit from another adapter instance.

Pure prepared jobs carry data, versions and results, never database handles or closures such as the current compaction `covers(lockedHistory)`. Tagma may execute heavy jobs through its shared capacity mechanism; the kernel does not start its own worker pool or assume Tagma's scheduler exists. Every other adapter owes the same snapshot/compare/apply semantics.

### 5.2 Identity, replay and fencing

For native run transitions, use `(runId, sequence)` with an immutable per-sequence request digest and accepted plan digest/outcome owned by the native run's transition ledger. `applied_seq` may remain a contiguous high-water index; one last digest is not evidence for every earlier sequence. Old-sequence retries compare their own request digest, not the most recent transition's. Two runs at sequence one are different acts.

The semantic request digest includes caller-supplied event payloads and patch intent where they are command input. Only genuinely derived fold/decision results may change during stale preparation or `redeclare` before acceptance. The unit stores both the immutable request digest and the accepted plan digest/result. Replay authenticates the request first and returns that result without executing or comparing a newly derived plan. Accepted event identities remain stable; changed semantic input needs a new key.

Driver ownership uses a durable generation/fence token, not merely a process name. Every event/usage/phase/interaction/output commit performed on behalf of that driver is conditional on the live token. Heartbeat is liveness evidence; it does not authorize an obsolete driver to write. Admission rechecks custody before a new model/tool dispatch; a driver that learns it was displaced stops dispatching and releases its local scope. A dispatch already crossing an external boundary at takeover remains uncertain unless that boundary also enforces the fence. A parked question retains its distinct takeover/answer reservation rules.

A run end retains its own immutable digest and minimal outcome on the run row. Terminal status alone cannot authenticate the failure diagnostics, actor, tail and withdrawal events of a replayed ending. A matching end replays; another ending has a typed conflict, and the same key with a changed digest refuses.

Caller-keyed records live for the thread's lifetime and survive archive/rest according to the accepted storage protocol. Deletion writes the required spent tombstones before cascading records in the same unit. The existing pre-migration limitation for untimed caller-chosen keys whose records were already deleted remains explicit; this design cannot recreate lost evidence.

### 5.3 Birth and deletion

Prepare a child's seed from an immutable parent snapshot including fold/head/inherited-field revisions. The birth unit rechecks parent rights, identity, current run/question and child absence; then commits catalog/mandate, the selected driver's state, native seed events/folds where applicable, inherited attachment/output references, the initial inbox receipt and every in-unit product participant together. A same-key retry returns the standing child without repeating those participants. External byte copying is prepared under resource custody outside the unit; the reference transfer remains in the birth unit.

External placement/preparation happens through an owner-held intent before birth and a recoverable readiness obligation after it. A failed post-commit readiness step does not silently delete an accepted child or recreate it under a new identity. The owner reports accepted-but-not-ready, retries idempotently or exposes a terminal refusal with cleanup state. This deliberately replaces the current standalone branch's post-commit delete-on-ready-failure behavior.

Deletion first prevents new admission, then ends current execution and recursively resolves child/resource obligations. Its final unit proves no execution/child can appear, records spent caller keys and removes eligible rows. External resources are released by durable intents and evidence outside the unit; a failed release remains pending/uncertain and prevents falsely reporting the resource gone. A transaction rollback cannot undo an already performed filesystem or host release.

### 5.4 Settlement is a durable ordered pipeline

A run's terminal state and its terminal facts commit together. The aftermath has named stages: close native interactions/compaction activity, update collaboration residency and child state, publish owed reports, decide follow-up wake, then product reactions. Required ordering is declared by the settlement owner, not inherited accidentally from layer subscription order.

Each required stage has an idempotency key and durable acknowledgement. Recovery resumes the first unfinished stage; completed stages are not repeated solely because a later one failed. A failed optional observer cannot consume the retry budget of mandatory queue wake/report delivery. Exhaustion records a diagnosable blocked stage and leaves an operator/recovery path; it never silently declares every reaction delivered. Its retry worker is wired at startup and on its declared cadence in the same change.

An accepted inbox item remains observable and retractable according to its own state even when no run currently holds the thread. Queue recovery and the read model do not hide work behind the existence of an active run. Ending-to-follow-up races keep the accepted queue rules unless explicitly amended; do not add a new actor model merely to make every race disappear.

## 6. Model calls and tool effects

### 6.1 The model port

The loop consumes a kernel-owned Effect-native model-call contract. `llm` owns request serialization, provider protocols, credentials' wire use and deployment presentation. The `agent` model adapter performs the conversion; `llm` never imports `agent`. Tool carrier and compaction-capability contracts required on both sides leave `llm/profiles` for their stable call-contract owner. A loop phase does not import the concrete model adapter for a helper.

A model client is acquired and closed in its product scope and shared by its borrowers until they finish. Every logical request owns its attempt scope, abort subscription, stream, preparation wait, retry waits and terminal record. A completed or cancelled request releases its work, including its abort watcher. A shared credential refresh belongs to the provider/account owner: cancelling one waiter neither kills another's exchange nor permits the cancelled call to send afterwards. That owner serializes rotating-token exchanges across every process sharing the credential and retains custody until its own bounded ending. There is no dropped Scope or detached watcher waiting forever for a signal after success.

One logical-call budget bounds the complete operation. Transport-head retry, body replay, auth recovery and kernel semantic retry consume that budget and their own explicit attempt allowance; they do not multiply independent default ladders. Profiles may narrow or propose retry behavior, never widen the product's ceiling. Credential/preparation deadlines, frame-idle liveness and total execution deadline are distinct reasons. A human approval wait is separately parked, not charged as active model/tool execution and not an excuse to leave preparation unbounded.

Every attempt produces a receipt with request/attempt identity, provider/model/account actually used, timing, visibility/acceptance evidence, usage when reported and its ending. Failed attempts and successful compaction passes followed by a later failure still contribute their reported usage once. Durable mode records available attempt evidence before admitting the next paid attempt or host tool; volatile mode returns it without promising persistence. Text, object, stream and compaction forms enter the same machinery. Unknown usage is not zero. Retrying a partially shown response preserves its transcript evidence and never dispatches incomplete tool calls from it.

Terminal failures preserve their typed owner and cause chain: selection/provider refusal, malformed ingress, port failure, policy refusal, effect uncertainty, conflict, cancellation, invariant defect or migration failure. Human/model wording is a projection, not the only carrier. One terminal run result determines both its returned outcome and its stream marker; cancellation is recorded once regardless of which call/tool/abort path wins.

### 6.2 The tool door

The tool plan separates **offered** schemas from **admitted** calls. Deferred discovery changes what is shown; a known deferred name may still run when admitted. A hard skill/prerequisite/capability denial refuses a guessed name even if the tool exists in the full catalog. Every host-executed call, including a human-approved resume, crosses the same door. Provider-executed tools are authorized as request capabilities before sending, recorded as remote execution evidence and never dispatched again locally.

Hook output types follow their phase: before-step plans offered/admitted tools; before-tool may refuse or prepare admission; after-tool may guide/report, never retroactively revoke an effect. A skill load and its gated call emitted together cannot cross the next-step visibility boundary. An unsupported directive is not silently ignored.

The door decodes untrusted arguments once, resolves the actual subject, captures it immutably and asks the unchanged policy. An unattended run does not turn `review` into `trust`: an ask that has no reader refuses with a capability/policy outcome. After approval, the resource owner validates that admitted identity/baseline inside its actual mutation or launch-admission boundary, holding the required fence through the act. A kernel-side stat followed by an unfenced mutation is not this guarantee. Changed or unavailable identities refuse under the existing consent; they are never normalized into a replacement act.

A call outcome carries separate facts for admission, dispatch and effect evidence. A pre-dispatch refusal is `not-started`. After the body begins, a throw, timeout or cancellation is `uncertain` unless the tool's owner supplies a committed/reconciled receipt or proof of no effect. `executed: false` cannot mean both denied-before-start and failed-after-mutation. Execution/retention/projection/publication failure are recorded separately so an after-tool hook cannot relabel a successful write as not executed.

Persistent mode records intent before dispatch. Each mutating tool declares recovery semantics: keyed replay, receipt lookup, observable reconciliation, or non-replayable uncertainty. The kernel never automatically reruns the last category. Cancellation requests stopping; it is not proof that an external process, filesystem write or remote request stopped. A detached call transfers explicit custody to its retained owner, with its deadline, output and cleanup obligation.

Cleanup has its own bounded lifecycle. A stuck release or delivery does not keep uninterruptible completion alive forever; persistent mode hands unfinished cleanup to a durable reconciler with a named resource identity. Loop-only mode reports unresolved cleanup and returns ownership to its caller. Neither mode reports release merely because it stopped waiting.

### 6.3 Scheduling and worlds

Tool concurrency, retained calls, run history and invocation deadlines are host-supplied policies validated at composition. Existing Tagma values may be passed unchanged initially; they cease to be constants of a shared kernel. The scheduler bounds queued preflights and executing bodies separately, enqueues dependency-ready work, and preserves output order by provider call ordinal. Consent and dependency waits take no body slot. Dependencies use the resource identity/binding resolved by its owner, including world identity; a lexical-only world claims only its local lexical guarantee. The scheduler does not create an unbounded Effect fiber per decoded call or repeatedly scan every earlier call to discover the same dependencies.

`agent-tools` requires an explicit `World`. Its pure type entry has no machine implementation import. Capability absence removes/refuses the capability; it never falls back to Bun/Node on the host. A machine world is composed only by the granted product owner. MCP sessions/pools remain owned by the product scope with its declarations and secrets; the native harness receives the palette/caller and adapts them into kernel tools.

## 7. Context, history and evidence

The context owner retains today's important distinctions: stored history versus current working projection; reversible media omission versus durable prune intent; a summary proposal versus a committed prefix replacement; measured input versus estimated addition; the thread's selection versus a foreign summarizer. Existing operator-selected summarizer and keep-warm decisions remain in force.

A compaction plan identifies the exact source revision/prefix, retained boundary, summary request budget, planned passes and continuation metadata. Model work happens outside the write unit. Commit rechecks the prepared versions and applies checkpoint, history delta, retired prune marks, usage references, activity outcome and request acknowledgement together. A moved prefix writes no obsolete summary. Request-scoped additional reduction stays labelled run-local; it cannot become a checkpoint for history that was never stored.

Pruning is a monotone decision with its own durable identity. It may precede the history fold, but the stored decision and recovery semantics are explicit and replayable. A failed compaction never restores already cleared output. Calibration and warmth remain evidence, not guarantees about future provider behavior; account/model/rung/prefix changes invalidate only what their contract proves.

Remove repeated whole-prefix work at its producer: precompute per-message/suffix costs for cut selection; reuse immutable prefix fingerprints and known request-envelope identity; materialize only the changed suffix and required placement seed; construct a pinned run index once per evidence reading. Mutation of an object behind a retained identity is forbidden by the immutable input contract, not hidden by another downstream normalizer.

Evidence pins head and ledger in one adapter snapshot. It reads archived/rested data through the storage owner, and preserves unavailable records as unavailable. Work budgets count every examined source record, including malformed rows; byte limits count encoded bytes; grouped state and unavailable diagnostics have their own memory bounds. An incomplete ranking/count states exactly the examined population and continuation, never a total over facts it did not read. Product access control happens before the pin; query admission happens once at the external decoder into a checked query value.

## 8. Live streaming, wire and promise surfaces

Durable recording and live viewing have different loss contracts. The recorder gets an ordered, backpressured channel and may not drop semantic events. Live viewers receive a bounded replay window with sequence and durable-position watermarks; a slow or late reader outside the retained window receives explicit resnapshot/resume instructions. Progress replacements may coalesce, but completed facts remain durable before the live window evicts them. No buffer is called bounded solely because adjacent text chunks are concatenated.

The `llm` transport/parser also bounds in-flight frame bytes, error-body reads and response assembly at the actual byte-reading boundary. A provider may exceed its advertised token/output limit; clipping a diagnostic after `response.text()` reads the whole body is not a memory bound. Exceeding a carrier limit produces a typed capacity failure with bounded retained evidence.

Limits belong to their owner: wire input/assembly, invocation/recorder capacity, replay bytes, output spool, query work, page rows and serialized frame bytes are separate. At capacity, admission waits under its deadline or refuses with the limiting resource; a live subscriber resynchronizes; output overflow is retained through its vault. Nothing silently truncates durable history, authority or a pending question. Diagnostics expose current/peak occupancy, oldest pending work and the active limit.

Wire DTOs are positive projections of their public schema, not spreads of storage rows with an omit list. Native-only phase bookkeeping is not serialized accidentally. Unknown version/arm behavior is declared at the actual wire owner. Browser consumers import only declared browser vocabulary/folds and wire contracts; permission vocabulary is separated from its Bun-dependent evaluator.

The promise surface is deliberately closed over promises, async iterables and plain values, including returned tool doors and handles. Effect-native construction remains explicitly Effect-native. The adapter cannot claim that an arbitrary nested callback or returned service is converted by a shallow proxy. Keep supported methods direct and typed; remove no consumed capability without replacing it at that same boundary. New conformance checks exercise actual promise calls and returned capabilities, not proxy implementation details.

## 9. Workflows and collaboration reliability

A workflow definition is parsed/compiled at its real ingress, including in-process authored plans. Width, nesting and aggregate active-member budgets are validated under the same contract; a JSON-only width check is insufficient. Recursion is admitted only under an explicit depth/total-work bound carried through nested calls. Limits belong to the workflow owner and product policy, not accidental spawn-tree depth.

Dispatch writes a durable step intent with a stable dispatch identity before the member begins. Member start/send/wait/recovery uses that identity; a restart looks up the existing child/result instead of duplicating work. A workflow driver lease fences every ledger write. Cancellation, terminal failure, paused/awaiting and retryable interruption are explicit outcomes with public control/recovery paths; no engine failure leaves `running` as an unowned permanent state. A stopped workflow resolves or deliberately transfers its member/child obligations and releases its lease.

Collaboration envelope acceptance and obligation closure remain idempotent. Reports are attributed to the request and handling execution, not whichever run happened to end later. Root-relative names remain unique for the thread lifetime, including archive. Rights are checked against current lineage at the act, while prompt/menu exposure is not authority. A single common birth admission applies name/provision/rights/depth/budget/residency before selecting the native or external driver; it is not copied into both products. Residency reservations are durable or rebuilt behind an admission barrier from authoritative live executions before any new child can start. An unknown external spend cannot be silently counted as zero; the product chooses an explicit admission policy for it.

Every inbox, waiter, report and nested-work population has a row/byte/work bound and an explicit capacity outcome. The read does not reload every pending item on every unrelated arrival. A workflow dispatch persists its absolute deadline, so restart spends only the remaining allowance; bounded member admission may overlap independent starts without creating unbounded fan-out. A persistent workflow composition requires a supplied driver that resumes eligible work at boot and on its declared cadence. Its product owns scheduling; the kernel owns advance/recovery semantics and will not claim durable progress for a hand-driven volatile composition.

## 10. Stored formats and rollout

Each persisted family has one owning codec and an explicit record format version: journal events, transcript/history values, checkpoints/prune marks, permission records and workflow state. Untagged existing values are decoded as the documented legacy version. `llm` owns its opaque/native presentation receipt's inner format; `agent` owns the enclosing event/message format. Product SQL columns/migrations remain product-owned.

A new format ships every carried old decoder or migrates Tagma SQLite in the same source change. Unknown future formats refuse with address/family/version evidence; they never decode as today's shape. Recovery-critical malformed state prevents driving that entity while evidence reads may expose the unavailable record honestly. Historical capture records are not rewritten to make a decoder pass.

The transition protocol upgrade closes admission across **all** writers of an adapter scope, makes every old native running row terminal—including awaiting-question rows—then migrates and starts the new driver. The current ordinary reaper excludes parked questions and is not this migration barrier. No old writer may keep using the new schema or be adopted as a still-running old-protocol row. Existing model-step numbers and journal positions remain intact. Continue after interruption opens a fresh run over the carried history. New per-transition sequence identities begin from an honest protocol baseline; no migration invents a digest or receipt for an old transition it cannot reconstruct. The precise baseline correction is in §12.

Rollback of a compile-time-only cut is a whole-product binary change. After new-format writes, rollback requires a retained reader for that format or restoration through the product's accepted backup/rollout protocol; it is not accomplished by dropping unknown fields. Running external executions are not killed for this refactor; their compatible adapter and custody remain until their own lifecycle ends.

## 11. Diagnostics and acceptance

Every long-lived owner reports identity/scope, state, current work, source revision/fence, pending obligations, last failure and resource occupancy. Correlate thread, run, episode, model request/attempt, tool call, transition, settlement stage and workflow dispatch without exposing credentials. Distinguish heartbeat from progress, cancellation request from termination proof, accepted mutation from publication failure, and unknown spend from zero.

The acceptance suite protects these contracts through public owners and real adapter boundaries. It does not pin wording, import spelling, helper call counts or file length. Static architecture checks and typechecks are the cheaper proof for entry roles and signatures. Owner tests cover pure transitions; adapter conformance covers durable/race behavior; a small assembled scenario proves composition. Tests follow the project's unit/integration/system budgets and worker ceilings.

1. **Substitution:** loop-only, persistent native and native-plus-each-optional-capability compose without hidden worlds/drivers. Tagma SQLite and the memory adapter obey the same port outcomes; external collaborators pass the common catalog/runtime contract without native history fields. A latest-run query with a status filter returns the newest matching row even when many newer rows have another status; no adapter applies an undeclared twenty-row horizon.
2. **Atomicity/replay:** inject failure before commit, after commit-before-answer and between every settlement stage. Replay returns the recorded result; no usage, inbox acknowledgement, child birth or product participant applies twice. Every old-sequence changed digest refuses, including after newer sequences committed.
3. **Concurrency:** two same-thread preparations may stale without being called corruption; one current run/driver fence wins; old writers cannot append or change phase after adoption; a stopped expected execution cannot target its replacement.
4. **Effects:** a tool that mutates then throws/cancels returns uncertainty or its own proved receipt, never not-started. Recovery observes/key-replays only declared recoverable effects. Permission subjects changed after approval refuse. Hard tool admission and unattended review cannot be bypassed by guessing a name or omitting a reader.
5. **Lifetimes:** success, refusal, cancellation and failed cleanup release or explicitly transfer every request scope, abort watcher, model client, call lease, output claim and subscription. Persistent unresolved cleanup remains recoverable and visible.
6. **Accounting:** retried model attempts, failed summarizer candidates and successful early passes before a later failure retain reported usage once under the account actually used. Unreported usage is visibly unknown.
7. **History/context:** replay reproduces durable folds; compaction cannot settle against a moved basis or break tool pairing; pruning remains monotone; pinned openings/deferred inventory/skill locks and provider continuation semantics survive their established cases.
8. **Evidence/streaming:** a concurrent new run cannot split a pin's head/ledger instant; unreadable records consume work/byte budget; a stalled viewer resynchronizes without losing durable events; duplicate/overlapping stream events remain idempotent and gaps are never silently folded.
9. **Workflow/reports:** restart after dispatch and before step settlement reuses the existing member; cancellation/failure leaves a terminal or explicitly recoverable workflow; width/depth/total-work limits hold for authored and decoded plans; reports and queue wake finish despite an optional observer failure.
10. **Formats/surfaces:** every carried legacy row decodes in both products; a future version refuses typed; wire runtime values match their public schema; promise-returned capabilities require no Effect runtime; browser doors load no server evaluator or client. MCP's owner proves declared secrets do not escape call/ping failures under its retained task, and structured redaction preserves decodability. No kernel sanitizer duplicates that fix.
11. **Scaling:** unchanged-history step/flush cost is governed by changed records and bounded preparation, not repeated full-history fold/serialization. Prefix selection is linear in examined message size. Evidence run indexing is once per pin. Budgets and slower-machine acceptance are measured by the implementing wave; this review supplies no timings or speedup claim.

## 12. Exact amendments proposed to accepted sections and package cards

### A1 — Section 3.13 §3.13.7.5: stale preparation

Replace the sentence beginning “A mismatch on a native thread is a defect” with:

> A preparation may become stale because another correctly ordered transition committed before this caller entered the lane. Retry preparation outside every hold, with the same key and event identities, under the call's absolute deadline and fair lane admission. Record the conflicting versions and retry count. Diagnose a lane defect only from evidence of an unregistered writer or a fold-input change inside the validated compare/apply interval; a second stale preparation alone is not that evidence. Deadline exhaustion answers the protocol's proved none/uncertain outcome.

Preparation precedes lane admission in the accepted algorithm, so repeated legitimate conflicts are possible. No successful-result or atomicity guarantee is weakened.

### A2 — Section 3.13 §3.13.7.5 and section 6: product-owned evidence

Replace the kernel `Evidence` union's product-specific arms and `CallKey`'s Tagma-owned types with:

> The kernel receives a namespaced opaque act identity and digest, plus the typed authoritative-record participant owned by the act's coordinator. Kernel-native record kinds remain kernel-owned. Tagma maps its `ActorRef`/operation key and command-delivery identity into this contract; `executions` reads/writes its delivery row through its in-unit participant. The first lookup decides replay/refusal/spent before any participant runs. No shared kernel contract names a Tagma table, operation vocabulary or database unit.

The accepted table remains the Tagma adapter's mapping, not an exhaustive union every product must implement.

### A3 — Section 3.13 invariant 8 and section 1's summary amendment: birth's lane

Replace the blanket “birth takes no lane / writes no journal or fold input” qualification with:

> Inbox-only control, command take-back and inbox-only merge notice take no journal lane. A native birth/fork validates the parent under the parent's lane and commits the child's seed journal/folds with its birth participants. The child needs no independently acquired lane before it is visible. A notice that appends journal events follows the journal lane rule.

This matches the accepted detailed birth protocol rather than its contradictory summary.

### A4 — Section 3.13 §3.13.7.5: per-sequence replay proof

Replace the run-transition row's “`applied_seq` plus last `applied_digest` decides every `seq ≤ applied_seq`” mechanism with:

> Native run storage retains one immutable transition record per `(runId, seq)`, containing that sequence's semantic request digest, accepted plan digest and outcome. Replay compares that request record, and changed semantic payload refuses even after later sequences committed. `applied_seq` is the contiguous high-water index only. The transition records survive archive/rest for the run/thread lifetime; deletion needs no tombstone for never-reused internal run ids.

Clarify `redeclare` and the common `Keyed.digest` definition:

> The semantic request digest is immutable, including caller-supplied events and patch intent that are command input. A stale/redeclared preparation may change only derived fold/decision data before acceptance; it has a separate plan digest. The acceptance unit stores the chosen plan and request digests/result atomically. Replay authenticates the semantic request first and returns the committed result without running or comparing a newly derived plan. Caller input cannot be relabelled as derived data to evade `act-id-reused`. A changed semantic request needs a new key.

For the upgrade, replace “initialize from the durable flush count” with:

> After every old writer is quiesced and every old running row, awaiting-question included, is terminal, initialize the new transition protocol's sequence at zero for old terminal runs. Existing model-step numbers and facts are preserved separately. Continue opens a fresh run id at sequence one. Old code issued no keys in this new protocol, so no fabricated historical receipts are required. Adopting an old running row instead, or upgrading an intermediate build that issued such keys, needs a separately specified conversion with genuine receipts or an explicit protocol epoch; it cannot infer identity from flush count.

Also replace the run-end row's status-only replay criterion with:

> The run row retains the immutable end digest and minimal outcome. A terminal retry compares that digest; matching status with changed diagnostics, actor, events or patch is not a valid replay. No generic second receipt table is added.

A single latest digest cannot validate an older sequence, status cannot authenticate an ending's payload, and a flush count is not a count of every transition.

### A5 — Section 2/6: after-commit work and ownership

Keep C2/C2b atomic participants and C4 external intents. Add the explicit distinction:

> A required post-commit readiness, resource-release or settlement reaction has durable identity and completion evidence; an observer is recomputable and cannot control the acceptance outcome. Resource-kind callbacks invoked inside a unit perform only their declared store writes. External release/readiness runs through an owner-held intent outside that unit.

This does not turn a presently atomic multi-owner birth into an outbox. It makes the external phases around that birth recoverable.

### A6 — Section 6 / `agent` card

Keep the accepted responsibilities, but replace the card's coarse P2 port/delta step with the keyed protocol and boundaries of §§3–5. The card must include model/client/request lifetimes, tool effect evidence, settlement stages, workflow recovery and bounded feed/evidence acceptance; renames alone do not answer them.

Do not declare the current whole `permissions` entry browser-safe: its evaluator calls `Bun.Glob`. Split pure declarations/decision vocabulary from the server evaluator and point browser exports at the real pure definitions. Do not retain `ThreadEnvelopes`' native fallback temporarily behind the new required runtime port.

The listed file-stem renames remain subordinate to the owner cut. Apply public path moves once with all Tagma, workflow and dynamic consumers; an unused static import count is not permission to remove a runtime entry. A cohesive owner is not split solely because it is large.

### A7 — `llm`, `agent-tools`, `agent-sources`, `mcp` cards

`llm`'s runtime gains explicit scoped client disposal and request/attempt evidence; stable call capabilities/carriers cease to be declared inside deployment profiles. The kernel's adapter remains above `llm`.

`agent-tools` requires the explicit pure World port and owns bounded workspace-tool behavior; kernel duration constants are replaced by supplied execution policy. Its `pageFamilies.ts:cursorField` stays as an operation-specific accessor; only repeated ceiling/limit arithmetic moves to `paging`, alongside the already accepted ownership of local families. `mcp` exposes its caller/result contract without SDK type imports in tools and is scoped by the product's declaration/secret boundary. Its installed redactor applies to connect/list/call/ping failures before publication; structured redaction preserves typed string leaves and decodability, and makes no image-byte secrecy claim. The existing [[42cb8372|MCP call/ping redaction task]] remains the owning dependency, not a new consumer sanitizer. `agent-sources` keeps parsing workflow input at the kernel's plan owner; its relation is service-plus-type where it calls that parser. These refine the existing cards without granting new product imports.

### A8 — The current model-client lifetime rule

The standing [[2d2e2841|one model client per process rule]] is not disabled by this idea. Once the scoped API and its callers are accepted and built, propose replacing its leak-dependent wording with:

> Acquire one model client per explicit credential/transport scope, share it with every borrower in that scope, and close it only after those borrowers finish. Never open a new client for each call.

The current single-client practice remains until that owner supplies real close semantics. A scope split requires different custody or policy, not a wish for another connection pool.

## 13. Standing graph work

All current claims not explicitly named below **survive as standing source-bound knowledge**; this draft neither re-verifies them nor declares them true at a moved baseline. Implementation re-reads and reconciles the affected owner before moving anchors. No claim is deleted merely because a file is renamed. The following limitations/mechanism claims are absorbed into the owning replacement only after that replacement lands:

- [[808916e7|The coarse thread floor]]: replaced by the measured owner DAG (§3).
- [[b4a4c425|Omitted planes retaining their shell]]: replaced by explicit optional composition (§4).
- [[7a3073c4|Erased adapter handles at harness entry]]: replaced by typed adapter/unit binding (§5).
- [[257c9f8e|Seal/place/fold in one unit]]: invariant survives; identity mint and preparation mechanism change (§5).
- [[e95f1d2b|Standalone ready failure deleting the branch]]: replaced by accepted readiness recovery (§5.3).
- [[73b40c30|A pinned head and ledger]]: its single-observation promise requires the snapshot port; current code does not establish it (§7).
- [[9ac665e5|The evidence work ceiling]]: rewritten to count unavailable source facts too (§7).
- [[784c9de0|The native door returned through the promise face]]: removed as a limitation when the closed promise boundary lands (§8).
- [[898ac62b|Tool-only wire caps]]: qualified by the declared frame budget and large-value retrieval contract (§8).
- [[fe4f1e0d|Wire-owned page figures and character weighing]]: replaced by owner-owned family budgets and encoded-byte accounting (§8).
- [[81650ca7|Promise one-shot lifetime]]: absorbed by the shared Effect-native model-call lifecycle (§6.1).
- [[758b8f18|The fixed step retry ladder]]: rewritten over one explicit attempt/elapsed budget (§6.1).
- [[0a5ebbe2|The loop's retry-stop reason]]: preserved as a typed owner/cause within the outer allowance (§6.1).
- [[988335aa|Unbounded call fan-out]]: limitation dies; earlier-write ordering survives under bounded admission (§6.3).
- [[abd62a1a|Skill exclusion]]: rewritten as executable admission (§6.2).
- [[4ab3c7b5|Step tool selection]]: rewritten as offered versus admitted (§6.2).
- [[bfff7fb2|Deferred selection]]: display behavior survives separately from hard gates (§6.2).
- [[87128ac7|A guessed deferred call]]: survives for deferred discovery only (§6.2).
- [[c4f28ff2|Unattended mode becoming trust]]: mechanism dies; explicit policy survives (§6.2).
- [[e31a7c60|Tool outcome carriers]]: rewritten over effect evidence (§6.2).
- [[6b081bea|Refused calls executing nothing]]: pre-dispatch guarantee survives, post-dispatch failures remain uncertain (§6.2).
- [[6ed606c7|Step result folding]]: rewritten to preserve that distinction (§6.2).
- [[31a1ad65|Call ending and release]]: rewritten over bounded cleanup and pending custody (§6.2).
- [[72e79680|Call stop and finalization]]: rewritten over bounded cleanup and pending custody (§6.2).
- [[d35d7ff8|Call duration policy]]: clock semantics survive; numeric policy becomes supplied input (§6.3).
- [[5a461f9e|Call envelope policy]]: clock semantics survive; numeric policy becomes supplied input (§6.3).
- [[5337b23b|Admission timing]]: preserved with explicit owner budgets (§6.3).
- [[d1d64ae5|Unconditional full in-memory replay]]: dies as an unbounded guarantee; bounded volatile retention and durable cursor replay replace it (§8).
- [[ab3e1ec9|Terminal failure projection]]: rewritten over a retained typed cause (§6.1).
- [[3c1e1480|Port failure projection]]: rewritten over a retained typed cause (§6.1).
- [[f310b4f9|Uniform terminal settlement]]: survives over one typed terminal outcome (§6.1).
- [[eb726c72|Promise-to-port lifting]]: replaced at the explicit language boundary (§8).
- [[1dbae3df|Port callback lifting]]: replaced at the explicit language boundary (§8).
- [[28c9827e|Storage callback adaptation]]: replaced by the typed transition binding (§5).
- [[2589dd38|Adapter failure conversion]]: retained only at the true boundary (§5).
- [[85692427|Transaction carrier]]: replaced by instance-bound unit semantics (§5).
- [[a6c22332|Transaction ownership]]: ownership survives under the typed adapter (§5).
- [[a5575667|Transaction callback contract]]: replaced by the prepared-transition contract (§5).
- [[482114f6|Optional ownership fills]]: rewritten to distinguish absent/volatile capability from missing durable ports (§4).
- [[e304b589|Step observer]]: accounting remains lossless; observers use bounded delivery (§8).
- [[a17f8e06|Spawn budget]]: common admission replaces the native-only current gate (§9).
- [[474a36fa|Residency seats]]: scope and restart evidence become explicit (§9).
- [[00c9c99e|Model judgment at birth]]: current-catalog edge judgment replaces schema-frozen admission (§4.2).
- [[60237965|Resource release inside a unit]]: store-only release is separated from recoverable external release (§5.3).
- [[1e8c4846|Duplicate resource kinds collapsing]]: replaced by composition refusal (§4.3).
- [[2d052f74|Settlement replay]]: at-least-once semantics survive; per-stage acknowledgements replace whole-bus repetition (§5.4).
- [[3fe7a194|Settlement subscriber order]]: order survives as a declared pipeline, not layer registration accident (§5.4).
- [[c680572f|Unclosed model-client scope]]: limitation dies after scoped disposal (§6.1, A8).
- [[37389012|Model retry limitation]]: rewritten after the bounded call protocol (§6.1).
- [[4c2fbd29|Model retry lifetime]]: rewritten after the bounded call protocol (§6.1).

The known in-process tool memoization and retention-failure guarantees survive at their real scope; none is promoted to cross-process exactly-once execution. Framing-liveness claims survive as liveness, never as a whole-call deadline. Scope-wide outdated baselines are not repaired merely by this disposition.

Every currently open task in the package has this proposed disposition; none is closed by this idea:

| Task | Disposition at implementation |
|---|---|
| [[3d7b5f1f|Wire resume/page ownership]] | Absorbed by §§3,7–8 |
| [[ee786d3b|Idle queued requests hidden from reads/take-back]] | Absorbed by §5.4; prove and repair the persistent state at the owner |
| [[ba48beac|Runtime wire fields exceeding the declared shape]] | Absorbed by §8 |
| [[ffbc4eb0|Two refusal carriers]] | Absorbed by §6.2's execution/effect evidence model |
| [[e8e39d1c|The unused checked event door]] | Absorbed by §5's one transition and §10's actual codec boundary |
| [[5d6e2c8e|Compaction dependencies in one options bag]] | Absorbed by §3's owner construction |
| [[a2276c1c|Deletion conformance missing inbox evidence]] | Absorbed by §11's deletion/adapter acceptance |
| [[ebe739ed|Authored workflow width bypass]] | Absorbed by §9 |
| [[0bd39a8f|Ambiguous composite entry identities]] | Absorbed by §§5,8: collision-free typed identity and carried old-record decode |
| [[681993b4|Compaction policy invariants]] | Absorbed by §7; derive current numeric constraints, not a removed comment's ordering |
| [[d2b49e17|Workflow drive failure left running]] | Absorbed by §9 |
| [[a2cac9a1|Unbounded workflow recursion]] | Absorbed by §9 |
| [[0ef3e10f|Composition rows not reconciling to their total]] | Absorbed by §7's evidence owner with deterministic remainder allocation |
| [[fedfe7e5|The incomplete promise door]] | Absorbed by §8 |
| [[32ecffe0|Abort-frame outcome depending on the winning path]] | Absorbed by §§5–6: one terminal semantic outcome and idempotent projection |

[[478a03df|The accepted summarizer decision]] and its child refinements survive, including account-aware warmth, resolution when taken, foreign continuation shape and named summarizer separation. The following accepted decisions survive explicitly:

- [[021c93b2|Cache-aware collaboration]]: keeps its accepted refinements below.
- [[0d839b13|An ordinary keep-warm turn]]: writes its exchange and runs no tool.
- [[073695fc|Compaction/task queue adjacency and its races]]: no stronger total-order promise is invented here.
- [[491e9c27|No stale held-token figure after compaction]]: unchanged.
- [[15773244|Waiting means a working descendant]]: unchanged.

This proposal changes ownership, accounting and recovery, not the operator's choice of model or summarizer.

## 14. Order of work and risks

1. **Contracts and acceptance boundary.** Accept/reject A1–A8 first. Finalize the owner DAG, common catalog/runtime, keyed/unit/fence vocabulary, tool effect evidence and model attempt contract. Update the package cards from that contract. No source move is needed merely to discuss it.
2. **Pure boundaries and formats.** Move pairing, folds, permission vocabulary and resume selection to their real owners; extract paging and declare entry roles/platforms. Add versioned codecs and migration fixtures before new writes. Keep existing behavior at these cuts.
3. **Durable protocol, all adapters together.** Implement transition records, source snapshots, prepare/compare/apply, birth, unit branding, fencing, tombstones and post-commit outcome reporting in kernel + Tagma + memory adapter. Convert every writer; leave no old bypass. This is the highest-risk wave: lost-answer replay, old-driver fencing and migration quiescence are release gates.
4. **Native lifetime and effects.** Implement model/client/request scopes, shared retry/deadline budget, attempt usage, tool effect outcome and cleanup custody. Convert the native recorder, questions and compaction to the new transition protocol. Fix bounded scheduling without changing consent semantics silently.
5. **Collaboration, workflow and resource recovery.** Supply explicit catalog/runtime compositions, remove native fallback, implement settlement stages and readiness/release intents, then workflow stop/failure/recovery and nested-work bounds. This wave must preserve request/report attribution and queue ordering across crashes.
6. **Evidence and surfaces.** Implement atomic pins, bounded malformed-record work, linear context preparation, bounded replay/resync, exact wire projection and the closed promise surface. Confirm old stored forms and existing clients under their version policy.
7. **Final public-path cut and proof.** Rename/reduce entries once with every product/static/dynamic consumer; run architecture checks, real adapter conformance and the accepted assembled scenarios; measure the agreed slower-machine/scaling cases. Re-anchor and reconcile graph claims from the code, then close accepted implementation decisions into those claims. No speed or reliability grade is awarded before these gates pass.

The main risks are coordinating both database adapters, upgrading while old writers still exist, distinguishing unknown external effects from safe replay, preserving provider continuation bytes, and preventing required post-commit work from being hidden by observer failure. No new SQL store, generic distributed workflow product, vendor protocol rewrite or machine-specific worker count is part of this draft.

## 15. Rejected alternatives

- **Move the concrete kernel adapter into `llm`.** It would make model wire depend on executable kernel tools and reverse the package boundary. Keep an explicit adapter in `agent` over stable `llm` vocabulary.
- **One universal durable harness with native-shaped rows for every collaborator.** It forces storage/native history onto loop-only callers and external CLIs, then fills the mismatch with empty values. Compose distinct lifetimes behind the common capabilities they can prove.
- **A package, interface or registry per existing file.** File size and export count establish no owner. Keep cohesive lifecycles, and add a contribution contract only for real contributors.
- **Renames, forwarding aliases and entry wrappers before ownership changes.** They retain the same wrong dependency and make a second consumer migration. Move definitions to the agreed owner and cut public paths once.
- **Make the event log, SQL state and sidecar file equally authoritative.** A filesystem append cannot roll back with SQL. Keep the accepted journal/export/rest authority protocol; repair orphaned projections at that owner.
- **Generic receipts beside every existing authoritative row.** Two records can disagree. Retain the act's own evidence; only the run-sequence act gains the record required to authenticate that previously unrepresented identity.
- **Treat cancellation/error as rollback, or retry every interrupted mutation.** The external effect may already have happened. Require keyed replay or a witness; otherwise expose uncertainty.
- **An independent retry ladder per transport, kernel and compactor.** Their product is an unowned spend/time budget. One logical-call allowance contains provider-specific retry mechanics.
- **Keep all events in memory so any future viewer can replay.** Memory then grows with an unbounded run. Durable storage serves historical replay; live/volatile retention has an honest ceiling.
- **Patch performance at consumers with throttles or caches.** Repeated whole-prefix work belongs to the fold/meter/query producer and is removed there.

## 16. Coverage and exclusions

The source/graph reading was split between the two architects and their bounded collectors; their reports identify whole-file versus targeted reads. These scope areas are covered by the indicated owning section, and otherwise retain their current semantics:

| Existing area | Target section |
|---|---|
| [[d45ec974|Loop]] | §§3,6 |
| [[89f2bd8e|Step phases]] | §6 |
| [[7b858c68|Model boundary]] | §6.1 |
| [[b645577c|Tool contract]] | §6.2 |
| [[0361efbb|Tool door]] | §6.2 |
| [[6f0a77c7|Moving model guidance]] | §§6.2,7 |
| [[8cb71755|Runtime events]] | §8 |
| [[b160c0e2|Run scope]] | §§4,6 |
| [[4c82c2b1|Permissions]] | §6.2 |
| [[b379a5a0|Transcript]] | §§5,7–8 |
| [[757d9a82|Wire]] | §8 |
| [[c3e78736|Thread]] | §§3–5 |
| [[53d0aee9|Stored shape]] | §§5,10 |
| [[c32ee699|Thread commands and event door]] | §§3,5 |
| [[c765e6ba|Product ports]] | §§4–6 |
| [[c4510285|Run machine]] | §5 |
| [[a43f39ba|Run lifecycle and reaping]] | §5.2–5.4 |
| [[f609c71a|Turn driving]] | §§5–6 |
| [[4321720c|Stream recording]] | §§5,8 |
| [[408c5fc6|Live feed]] | §8 |
| [[d0b58b13|Questions and parked work]] | §§5.2,6.2 |
| [[9da5905b|Incoming work]] | §5.4 |
| [[e801d5b9|Execution context]] | §§4,6.2–6.3 |
| [[6e94ed66|Agent definitions and profiles]] | §4 |
| [[ca2d112a|Request composition evidence]] | §7 |
| [[37580f83|Cache warmth]] | §7; no new vendor-cache promise |
| [[4b32b3eb|Evidence selection]] | §7 |
| [[da7da0be|Branches]] | §5.3 |
| [[924ce8b4|Thread failures]] | §§5–6 |
| [[d9690fa9|Harness composition]] | §4 |
| [[8faf533f|Compaction]] | §7 |
| [[3ef6226b|Collaboration]] | §§4,9 |
| [[99653ee8|Workflows]] | §9 |
| [[5501ab0b|Resources]] | §§4.3,5.3 |
| [[f802aa07|Built-in questions and ready answers]] | §6.2; interaction wording and choice cardinality unchanged |
| [[01fc2b5f|Promise surface]] | §8 |
| [[c719285e|Adapter conformance]] | §11 |

out: provider protocol implementations and OAuth UI beyond the named lifetime/accounting/security boundaries; external CLI internals and their own restart guarantees; execution-host wire redesign; a generic durable-workflow platform; new retention/deletion policy for canonical user data; numeric policy values not derivable until the implementation's workload measurements. These are not necessary to accept this kernel contract and are not implied work.
