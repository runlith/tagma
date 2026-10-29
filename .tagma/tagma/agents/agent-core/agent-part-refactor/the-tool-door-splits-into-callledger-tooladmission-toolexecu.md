---
id: 01a118eb-3e7e-7085-8f2e-2cd49bc6e931
title: The tool door splits into CallLedger, ToolAdmission, ToolExecution and OutputProjection
ord: 10
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentToolDoor.ts
---
Goal: the tool door — the single path of every call — splits into four subjects. Admission, execution and output-projection edits stop colliding in one mutable class, and the door's outside contract does not change.

## Now

`AgentToolDoor` (1208 rows without imports, 72 commits in two months) holds eight maps, an `active` counter and a phase (`AgentToolDoor.ts:188-221`) for five subjects:
- call memory and idempotency by `toolCallId`;
- admission: decode, `beforeTool` rules, prepare, subjects, permission, confirmation (`:643-726`);
- execution: tracking, resource holding, run-stop linkage, record order, background receipts (`:923-1161`);
- output projection and pictures (`:747-783`, `:1223-1275`);
- `afterTool` rules.

Its options object (`:93-113`) carries 15 fields, including dependencies. The constructor calls `Effect.runSync(Scope.provide…)` (`:217-220`). `Date.now()` stands next to `Clock` (`:1176,1207` vs `:646`).

## What is built

Four owners in `agent/door/`:
- `CallLedger` — memory and idempotency by call id;
- `ToolAdmission` — decode, before-rules, prepare and permission. The mode verdict arrives through a contract declared on the door's floor. The confirmation contract it needs is likewise declared on the door's lower floor: `thread/interaction` ([[fb39e560]]) fills it, and composition binds. The door does not import the thread question and mode owners ([[e090f46d]]). Until [[fb39e560]] the current confirmation implementation fills the port.
- `ToolExecution` — `AgentCalls`, resources, run-stop linkage, record order, background and the call-stage outcome. The outcome owner stores any call's outcome, and the timing of existing `afterTool` rules is kept: today they are not reached on execute or projection failure (`AgentToolDoor.ts:1110-1142`). A hook extension to a failed or interrupted call is only by an explicit outcome contract, without turning the source failure into success;
- `OutputProjection` — `ToolOutput*` and pictures.

Requirements on them:
- The door facade keeps `preflight`, `settle`, `settled` and `decline`.
- The door fills `caller` ([[b771b4db]]) and executes only the effective admission of `resolveCatalog` ([[8451c5c9]]).
- Dependencies are positional parameters ([[c2f04d22]]); time comes only from `Clock`; constructors do not call `runSync`.

## Acceptance criteria

- The `AgentToolDoor*.test.ts` tests pass without changed assertions, moved to their owners.
- No file in `agent/door/` exceeds 650 rows without imports, and the `AgentToolDoor.ts` debt record disappears.
- `rg` over `agent/door/`: neither `Date.now` nor `runSync` nor an options object with a dependency.
- The dependency graph on the module card: `agent/door/` does not import `thread/`.
