---
id: 01a11c26-7d19-7b9a-8bcc-29594a024c48
title: Every road calls one judge and places the approval question in one Questions; the consent mechanism is removed
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/asks/decision.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/admission/callers.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/contract/service/consentSeats.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/nativeDoor.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/perform.ts
  - kind: file
    ref: packages/agent/src/agent/door/ModeVerdicts.ts
---
Goal: every road on which an agent performs an action calls one `judge` ([[2ebe1a79]]) exactly once per attempt — between prepare and execution. An approval question from any road is a record of one `Questions` ([[fb39e560]]). The consent mechanism leaves as a separate entity ([[acb620dd]]). Roads differ only in how the caller waits for the answer, and that is a transport property.

## Roads

| Road | Now | Target |
|---|---|---|
| Native door (`agent/door/ToolAdmission`) | `ModeVerdicts(mode, floor, modeOf, questionWaitMs, modes = builtinModes)`. The question is a `pendingInteraction` slot, the run parks. | The verdict port of the door is filled by `judge` with the server registry, bound in composition. No defaults. The run parks on the `Questions` question. |
| Tagma operation as a native tool (`invocation/nativeDoor.ts`) | The door judges subjects together with consents. Execute calls `admitOperation` again: `callers` and the operator-operation consent. | Only the door judges. Execute checks only identity (`callers: 'thread'`) and passes the admitted conditions to the body. |
| `tagma op`, HTTP, socket, MCP (`invocation/perform.ts`: `perform`, `executeById`) | `admitOperation`, prepare, `consented` → `consentFor`. The question sits through `ConsentSeats` = `HarnessPermissions.consent`: only a terminal CLI facet with a live session. On `acp` and at a native flow — `Unseated` and refusal. | One admission: identity, prepare, `judge`, the question is a standalone `Questions` record of the invoking flow with an action key. The call waits to the door deadline (50 s, today `CONSENT_WAIT_MS`), then answers `approval-pending` with the question id. |
| Hosted (`call_hosted_tool` → `ThreadHosting`) | The hosting door; the question is a transcript record plus `Deferred` ([[7c54d3ed]]). | Like the native door; the question is `Questions`. |
| Foreign-CLI hooks (`judge_harness_call`, `record_harness_outcome`) | `HarnessPermissions.verdict` → `permissionOutcome([], …)` with built-in modes by default. The question is a `facet.question` with `source: 'hook'`, answered by `answer_ask`, and `record_harness_outcome` waits on the facet for 10 s. | `judge` over the vendor tool's declaration from the adapter row, with the server registry. The question is `Questions`, the key is the vendor call id. `answer_question` and `answer_approval` answer ([[52a9ca4e]]). `record_harness_outcome` reads `Questions`. |
| A vendor permission request over ACP (Devin, `protocol/questions.ts` `ProtocolAsks.asked`) | `permissions.verdict`. When silent, allow-once is picked automatically, otherwise the question parks in a facet with `source: 'protocol'`. | `judge`. `allow` is automatic allow-once. `ask` is a `Questions` question; the answer the driver translates to vendor allow-once or reject. A choice Tagma did not ask about (`agent-choice`) stays the vendor's question in the facet. |
| The door after the question answer and at an accepted run (`ThreadAgent.toolDoor`) | `new ModeVerdicts(input.mode, floor, undefined, …)` — built-in modes by default (`ThreadAgent.ts:485`). | The same port as the native door. Building a door without a registry is a type error. |
| A run that cannot wait (`interactive: false`: compaction, `RunScheduler.ts:255`) | `ask` becomes an "nobody to ask" refusal. | `ask` gives a typed `no-approver`. |

An operator caller is not judged on any road ([[fe7e09a3]], the operator's-authority rule). A foreign caller is admitted by `external` as today. An operation with `callers: 'thread'` called by the operator refuses with `thread-required`, as today. An operation with `callers: 'operator'` called by a flow refuses `operator-only` with unblock "ask the operator to perform" on every road and in every mode.

## Standalone question and action key

A call that did not arrive through a run door (`tagma op` from `bash`, MCP, CLI hooks) cannot park a run. Its question is a `Questions` record of the flow, not tied to a model call:

- **Action key** — today's `consentKey`, renamed. It is computed in the worker per [[7a910861]] from the flow, operation, input, call place (today's `ConsentRoute`: project, cwd, checkout, branch, heads) and raised conditions with their facts.
- **Repeat and receipt.** Repeating the same action after the answer reads the recorded answer and uses it once. Different input, place or fact is a new question. That is the [[fe7e09a3]] contract, spread from CLI flows to all flows.
- **Lifetime.** The question lives until answered, until its deadline, or until the flow ends. A call end and a run end do not remove it.
- **Visibility.** The operator sees it with the same confirmation window and in the attention list as a run question.

That adds to [[fb39e560]]: there the question lives to the run's logical end, while a standalone question lives to the flow end.

## Removed

- `packages/agent`:
  - `Consent`, `consentSubjects`, `consentsOf` and the `consent` field on `PermissionSubject`;
  - `consentAsked`, `askedBy`, `deniedBy`, `matchesGlob`, `pureRead` as a separate export (the rule goes to `judge`);
  - `PermissionPolicy`, `permissionPolicySchema`, `permissionOutcome`, `unconditionalDenial`;
  - `ModeVerdicts`, `consentedConfirmation`, `REVIEW_RULE`;
  - `permissionFloor` in `Agent`, `AgentDefinitions` and `CapabilityDeclaration`;
  - `questionWaitMs`.
- Tagma:
  - `invocation/consent.ts`, `contract/service/consentSeats.ts` (`ConsentSeats`, `ConsentRoute`, `ConsentUntil`);
  - `platform/contract/wire/consent.ts`;
  - `HarnessPermissions.consent`, and `verdict` and `judge` on built-in modes;
  - the `harness_consent` table and `ConsentReceipts`;
  - `hook` and `consent` sources on `facet.question`;
  - the `consent-required` and `consent-denied` codes;
  - `threadsPermissionBaseline`, `settingsPermissionBaseline`, `commandRulePermissionBaseline`, `crossingPermission`;
  - the floor record in `admission/callers.ts`.

`facet.question` remains only for the vendor's own questions: the screen widget and the vendor choice over ACP. That matches [[7c54d3ed]]. `answer_ask` answers only them.

## Mode id

Every place taking a mode id decodes it by the registry and refuses `mode-unknown`:
- flow birth;
- the `agent.approvalMode` setting, whose picker is built from the registry (intersects [[e8ba4977]]);
- `set_thread_authority` and `ThreadModes.move`;
- foreign-CLI flow birth.

A child inherits the parent mode, as today.

## Acceptance criteria

- A test per road from the table: one action in one mode gives one verdict, and at `ask` — one `Questions` record with the same causes, approver and deadline. Roads:
  - native door;
  - operation as a native tool;
  - `tagma op` over HTTP with a flow grant;
  - MCP with a flow grant;
  - hosted;
  - hook with a vendor tool;
  - ACP vendor request;
  - door after the answer;
  - accepted run.
- A `tagma op` test:
  - ask → after the door deadline (fake clock) `approval-pending`, the question stands;
  - the answer → the repeat executes once;
  - a second repeat asks again;
  - changed input is a new question.
- Test: the deadline expires identically on the native, hosted and `tagma op` roads — `unanswered`, the question is `lapsed`, the action is not executed.
- Test: an operator operation from a flow on every road and in every mode, including bypass, refuses `operator-only`; the operator passes with no question.
- Test: an unknown mode id at birth, in the setting and on change refuses `mode-unknown`.
- Test: a compaction run that got `ask` refuses `no-approver`.
- `rg` over the "Removed" list is empty.
