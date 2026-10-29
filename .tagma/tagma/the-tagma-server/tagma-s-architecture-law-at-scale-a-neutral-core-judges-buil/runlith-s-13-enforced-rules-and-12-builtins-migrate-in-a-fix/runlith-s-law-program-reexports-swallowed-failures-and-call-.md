---
id: 01a0f4ab-e319-78fe-8a92-a21eb822dabc
title: "runlith's law program: `reexports`, `swallowed-failures` and `call-services` moved verbatim into `checks/law` with proven parity"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f587-c835-7b6e-abd4-4fce5a9c787f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0526-7928-a1ce-c58bcdf2a89f
  - kind: waits-on
    to: 01a0f4ab-e311-7a99-af0d-be9c544301b1
  - kind: waits-on
    to: 01a0f4ab-e316-7f2b-bdee-e44c081cfd4b
---
Move `reexports`, `swallowed-failures` and `call-services` verbatim into runlith's `checks/law/` as one contract 2 program on a `runlith-law` descriptor, and prove parity ([[cdf2a89f]] §4.1–4.2). Same fingerprints, `.svelte` reading and import-binding resolution; the program may import `@runlith/code-facts`. The operator expanded the closing stage to real prepared-environment integration and resolving the 45 unjudged recovery sites without new allowances.

**Class:** complex — `claude-opus-5-5` high.

**Accepted boundary:** the project-owned program and parity stage is concluded with the remaining 24 sites explicitly unjudged, as the operator's final relay required. A typed refusal in a public protocol is not presumed to be an Effect failure. Adoption, debt comparisons, removing the old builtins and the Effect-source audit remain the separately authorized migration stage of [[cdf2a89f]]; none happened here, and the old gates remain standing.

## Delivered

- `f253336930`: project-owned program, descriptor and workspace declarations.
- `27b03d0136`: real-git non-UTF-8 refusal parity and scoped checker harness compatibility.
- `4908dce612`: checkerLocator at a committed HEAD, actual planChecker.prepare and scoped immutable cwd/argv in both parity roads; raw-tarball CheckerPackages port, registry and offline-mirror fillers, root postinstall mirror provisioning; typed error mapping and exact NotFound handling at their owners; identical ambiguous-overload correction in builtin and program, with memo version 3.
- `659723db86`: six tagged launch failures preserve their read-back decision; SqlError alone routes an unavailable reader to the writer.
- `a728cb6a61`: prepared corpus covers ambiguous refail/die forms and the builtin's limitation text matches the reader.

The standing program owner is [[e5d293e5]]. [[bc152245]] records the real preparation road; [[0dfa199d]] records transport substitution without changing raw sha512 validation. Muse supplied reading only; implementation and graph writes were made by the task's holder.

## Measured parity and checks

At `a728cb6a611be9eb7c9fa2b5b12d197187377e42`, the actual locator is runner `runlith-law`, manifest `checks/runners.json`, digest `647b676fe2201e323a0ca3fb6a386774f94faaf42e6a236ee9d1232289bef77d`. One checker process ran from its sealed prepared directory. Program and legacy CLI agree over the whole reach: reexports 6669 paths, 0 findings/0 unjudged; swallowed-failures 2923 paths, 0 findings/24 unjudged; call-services 2480 paths, 0 findings/0 unjudged. `gateRunnable=false`; adoption is `not performed`.

The canonical parameter hashes are unchanged, including swallowed-failures `c107f4b3e61f41158f20f05d0166af4554eb68f0812930806e2c554199b61564` and all 259 allowances. Reproduce with `bun run --cwd checks/law parity:head -- --head=<commit>`; it reads canonical parameters from the graph at invocation.

Law, agent-tools, llm, executions and sqlite-process typechecks pass. Selected tests pass: 3 law/input tests, 13 reader tests, 3 ToolEdge tests, 6 prepared-environment tests, 11 agent-library tests, 3 execution-spawner tests and 25 SQLite tests. With one test worker and the layer guard, measured processor time was 4.060 s for prepared parity, 0.083 s for the reader unit file, 1.103 s for checker preparation, 2.163 s for agent library and 6.220 s for SQLite. Missing and corrupt mirror bytes refuse through real prepare; ordinary postinstall supplies the offline mirror without bypassing the network guard.

The broader server typecheck failed outside this work during parallel code-facts/adapter/enforcement changes: `packages/code-facts/src/blobs.ts(2,55): TS2724 ... no exported member named 'Declarations'`; the same run also reported `filesRunner.ts`'s missing runner export and `enforce.ts`'s `pinnedAt`, `measuredLaw` and `packCheck`. No errors named the changed checker, CLI, library or package recovery code. Those other changes were not repaired here.

## 21 of the original 45 resolved

| Sites | Code owner and correction |
|---|---|
| 8 in executions/cli/host.ts; 2 in host/resolve.ts | [[80346cf6]]: refusal translation maps the error instead of catch-all recovery; the same CLI Refused defect and exit behavior remain. |
| ToolEdge.runToolEffect; 3 bash/tool.ts sites | [[48cee2cc]]: ToolFailed is mapped in the error channel; interruption and defect handling remain separate. |
| llm one-shot.post; oauth vendorCallOrFail | [[5d55b7bf]] and [[1956257e]]: map the existing LLMError/OAuthFlowFailed values rather than catch-all recovery. |
| native-harness agentLibrary.previous | [[8ec9c71c]]: exact PlatformError/NotFound becomes null; every other error retains the agent-file-io refusal. |
| providers credentialsHeld; targets placementRefusal | [[1105d017]]: both reader copies prove the possible final fallback can re-fail when the overload shape is ambiguous; successful or unknown fallbacks remain unjudged. |
| executions executionSpawner.spawn.outcome | [[556cf493]]: all six declared failure tags are handled explicitly; sent requests still read back the operation rather than re-dispatching. |
| sqlite-process make.offWriter | [[d3865b0c]]: only the pool's declared SqlError routes the read to the writer; defects pass through. |

## Remaining 24: owner and reason

Paths below are relative to the repository; line numbers and site hashes are from the measured final commit. No allowance was added, and none of these sites is asserted clean. The reader follows syntax inside the handler, not arbitrary named functions, port implementations, protocol consumers or lifecycle state machines.

| Site(s) | Owner | Why still unjudged |
|---|---|---|
| apps/tagma/server/src/change-record/record/write.ts:245 — ChangeLog.landed, 064779b6 | ChangeLog; graph lookup reaches only [[05042d40]] | keepLater persists a pending write and answers false. Proving retry/durable failure preservation crosses the helper and pending-operation owner; replacing false with an Effect failure changes the record port's contract. |
| apps/tagma/server/src/cli/door.ts:38 — ask, 4b30ac62 | [[03de79f4]] | undeclaredAnswer is a named asynchronous helper that re-fails after reading a response body. Its refailure is not proved inside this handler; it needs binding-aware helper analysis, not an allowance. |
| apps/tagma/server/src/cli/invoke.ts:40 — invoke, 44079b91 | [[03de79f4]] | exitCodeOf maps refusal to process exit 2/1. The external helper and entrypoint must be read to establish the public failure protocol; an arbitrary successful number is not a proved refusal. |
| apps/tagma/server/src/enforcement/judging/judge.ts:531/536/549 — judgingBuilt.judged 86806b22, judgingBuilt 727f9517, judgingOver fd933e63 | [[8cdf419f]] | failed/unbuilt/unresolved build Judgement.unjudged, which downstream gates render as refusal. Proving it requires the helper and judgement consumer, not interpreting successful Effect<Judgement> as failed. |
| apps/tagma/server/src/executions/terminals/writers.ts:150 — TerminalWriters.persist, 605d6ef1 | [[03c2423c]] | log and trailing retry keep an unstored mark. This is best-effort background persistence; re-failing would change the live writer-note lifecycle. |
| apps/tagma/server/src/external-harnesses/sessions/drive.ts:343 — SessionDriver.attended, 63666e0b | SessionDriver; graph lookup reaches only [[05042d40]] | uncertain writes lifecycle state and later reconciliation consumes it. The state transition is outside the handler's syntax; success after writing uncertain is not an Effect failure. |
| apps/tagma/server/src/installation/cut/release.ts:313 — releasing.nativeModules, ef9784be | [[c0f69bd1]] | refuseEarly logs and returns ReleaseRefused through another function. The handler calls that helper, which this reader does not resolve. |
| apps/tagma/server/src/threads/birth/delegation.ts:43/47 — republishOnMachineFlip, 037a6106/4cee34b6 | [[70db8905]] | the returned logged handler rethrows interruption and otherwise warns so the follower survives. Its higher-order binding and best-effort failure policy are not locally proved. |
| apps/tagma/server/src/threads/journal/rolloutReconciling.ts:45/59 — settle c96d9183, bring f1a65b2a | [[298493d0]] | remark schedules retry and the handler answers 0. A persisted retry marker and its future consumer are not proved by this syntax reader. |
| apps/tagma/server/src/worktrees/listing/rowReader.ts:88/180 — rows 84d7883f, refused 56904de5 | WorktreeRowReader, [[b413ff57]] | declaredRefusal validates the admitted code and fails with GateRefusal in an imported helper. This needs helper resolution; replacing it with an unchecked error mapper would drop admission validation. |
| packages/agent/src/thread/run/ThreadRunLease.ts:638/655 — notify 2b00a9fc, beating b9848d30 | [[a43f39ba]] | notify warns, sleeps and retries recursively; beating warns and keeps the heartbeat alive. Re-failing changes lease liveness; syntax cannot prove the maintenance protocol. |
| packages/execution-host/src/HostConnections.ts:630 — make, fad55cf4 | HostConnections; lookup names [[b714b21c]] but no accept-loop claim | non-interruption closes another scope with the failing Exit. Scope.close receiving that Exit is not itself proof of re-failure or of an externally observed refusal; the lifetime/consumer must be read. |
| packages/execution-host/src/registry/work.ts:69 — pipeline, bd580587 | registry pipeline; graph lookup finds no owner | the handler sets broke; ensuring later ends the record/source stream as error. A Ref.set alone does not prove the end-of-stream refusal across the callbacks. |
| packages/llm/src/llm/route/auth.ts:48/61 — credential.orElse b0fdf855, auth.orElse 5ea06a80 | [[5d55b7bf]] | a supplied next credential/auth link may succeed or fail; earlier deliberate refusals are discarded. The public fallback contract is [[06af4a67]], not proof that every supplied link preserves refusal. |
| packages/performance/src/store/worker.ts:46 — main, 9c4fcb33 | [[d4b6f6d5]] | runner.send emits StoreUnavailable over an imported worker protocol. The spelling of a tagged object cannot prove what that port and its consumer do; it is not an Effect refailure. |
| packages/trace-bundle/src/TraceBundles.ts:191/440 — payload 424a49c7, submitPayload a7e20e7c | [[76264b0c]] | the sink records a drop, flags failed payloads or writes stderr while protecting the watched run. These are cross-method best-effort lifecycle decisions, not locally proved typed refusal. |

The operator required these unproved cross-function/protocol cases to remain unjudged and the program stage to conclude with this list. Further binding-aware analysis or a change to any owner's public failure policy is outside this closure; adoption remains blocked by contract 2, without changing the 259 allowances or enforcement.
