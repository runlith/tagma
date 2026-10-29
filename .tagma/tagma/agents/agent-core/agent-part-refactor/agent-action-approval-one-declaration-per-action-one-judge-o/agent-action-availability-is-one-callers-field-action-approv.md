---
id: 01a11c26-7d19-7b9a-8bcc-29582ebe1a79
title: Agent-action availability is one callers field; action approval is declared explicitly — rung, conditions, timeout — and a pure judge derives any mode's verdict
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: packages/agent/src/modes
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/operation.ts
  - kind: file
    ref: packages/agent/src/agent/tool.ts
  - kind: file
    ref: packages/agent/src/permissions/floor.ts
  - kind: file
    ref: packages/agent/src/permissions/vocabulary.ts
---
Goal: every action has one explicit approval declaration, and one pure `judge` function derives the verdict for any registered mode from it. A new mode, a new condition and a new action are each added in one place. No shared defaults — neither rung nor timeout.

## Availability is one field, unrelated to modes

Whether an operation is available to agents is said by one field of its declaration — `callers`:
- `'operator'` — the operator keeps the operation to itself;
- `'any'` — it is available to the operator and agents;
- `'thread'` — a flow protocol, called only by flows.

The field is independent of trust, review or bypass, and of rungs. An operation the operator keeps to itself refuses the agent with `operator-only` in every mode. Any such operation becomes available with one change of that field, `'operator'` → `'any'`.

Nothing else changes in the process, because approval is declared on every operation, including operator ones, where it waits its turn. Offering the operation to the native agent as a tool is a separate `tool` field. That is an offer, not a right ([[54c5fcd2]]), and it is likewise mode-independent.

## Approval declaration

Types live in `packages/agent/src/permissions`, the lowest module that needs them ([[144dfedc]]). Low server floors may already import `@runlith/agent/permissions` ([[0d2c66a9]]).

```ts
type Rung = string                          // id of a registered mode
type Timeout = Duration | 'none'            // 'none' — waits for an answer as long as it takes
type Condition = {                          // declared by the module owning the fact
  readonly id: string                       // 'outside-subtree'
  readonly label: string                    // 'Outside your subtree'
  readonly asksFrom: Rung
  readonly timeout: Timeout
}
type Approval =
  | { readonly asksFrom: 'never'; readonly when?: readonly ConditionUse[] }
  | {
      readonly asksFrom: Rung
      readonly timeout: Timeout
      readonly why?: string                 // reason phrase when its own rung asks
      readonly when?: readonly ConditionUse[]
    }
type ConditionUse = Condition | { readonly condition: Condition; readonly asksFrom: Rung; readonly timeout: Timeout }
type Raised = { readonly condition: string; readonly fact: string }
```

The API form is the implementer's choice. Required:
- The declaration is static, and prepare only raises the listed conditions with fact text.
- `approval` is required on every operation and every tool. The type does not let it be skipped.
- Every rung that may ask names the timeout explicitly: a duration or `'none'`. The type does not let that be skipped either. `asksFrom: 'never'` carries no timeout, because that action's own rung never asks.

Where the declaration lives:

- **A Tagma operation** — the `approval` field in `OperationShape`/`DeclarationShape` (`platform/contract/wire/operation.ts`). `raises(input, prepared, actor) → Raised[]` replaces consent-subjects inside `subjects`. Shared family constants (`GRAPH_ACT`, `GRAPH_READ`, `ASK_TOOL_WRITE`, `operatorAct`, `socketAct`…) carry the family's shared approval the same as doors today. Example: `when: [otherProject]` on graph operations.
- **An agent tool** (`agent/tool.ts`) — the `approval` field. Prepare returns `raised` next to `subjects` and `prepared`.
- **MCP-server tools.** The MCP module declares one approval per server-classification class (`kinds`, `mutates`):
  - reading — `asksFrom: 'never'`;
  - the rest — `asksFrom: 'review'`, `timeout: 'none'`.

  These tools raise no conditions.
- **Foreign-CLI tools.** The vendor adapter row explicitly declares the approval of its tools by name. Today those are the `KINDS` and `MUTATES` tables in `external-harnesses/asks/decision.ts`; under [[6f758080]] they move to the adapter.

`PermissionSubject` stays the description of what a call touches. It is also read by execution rights (`executions/commands/access.ts`) and path rooting. The `consent` field and glob-matching of subjects against floors disappear.

## Modes are rungs

The mode descriptor from [[bb429da3]] changes: instead of `verdict(call, floor)` it carries `strictness: number` and an optional `refuses(act) → { code, reason } | null`.

- Built-in modes: `bypass` 0, `trust` 1, `review` 2. `elevated` and `confirmsWaiting` stay.
- Composition translates every rung of every declaration into a number once per registry revision. An action or condition naming an unregistered mode fails composition with the declaration and rung names.
- `ApprovalModes` is a plain service with no `defaultValue`; the core and Tagma get the server registry only through ports.

## Judge

`judge(approval, raised, mode) → Verdict`, a pure function with no IO, O(raised conditions):

1. When `mode.refuses(act)` returns a refusal — the mode's code refusal.
2. Causes: the action's own rung (unless `never`) and every raised condition with its rung and timeout from the action's `when` or from the condition itself.
3. Causes whose rung is no stricter than the mode ask: `strictness(rung) <= mode.strictness`.
4. No asking causes — `allow`. Otherwise `ask { reasons, timeout }`. `timeout` is the smallest duration among asking causes; `'none'` does not shorten the deadline. When all are `'none'`, the question waits for an answer.

A condition raised by prepare but not listed in the action's `when` is a code defect: the door fails with `DoorMisuse` instead of passing the call.

Before the judge, not its business:
- `callers` gives `operator-only`;
- the definition's grant and `deny` ([[8451c5c9]]);
- the withdrawn-source `contributor-absent`;
- system limits — spawn depth, budget and slots, switched-off delegation — are their owners' typed refusals in every mode, not approval ([[4946aca5]]).

A mode that is not registered but is recorded on a flow refuses `contributor-absent`, as today.

### Built-in modes table

| Cause | `bypass` | `trust` | `review` |
|---|---|---|---|
| `asksFrom: 'never'` | allow | allow | allow |
| `asksFrom: 'review'` | allow | allow | ask |
| `asksFrom: 'trust'` | allow | ask | ask |
| condition on `review` | allow | allow | ask |
| condition on `trust` | allow | ask | ask |

## What the question shows

`ApprovalView` is built by one function in `permissions`. The view holds:
- the action's own confirmation: `summary`, `facts`, `consequence`, `intent`, `confirmLabel` — already declared on operations and tools;
- asking causes: the action's `why` (without it — the mode's words, e.g. "review asks about every change") and `label: fact` of every condition;
- approver and deadline — filled by `Questions` ([[4a024c48]], [[52a9ca4e]]).

The view is drawn by `ToolConfirmation` from chat-ui on every road. It reaches the parent in words ([[52a9ca4e]]). Today the cause shows only when the confirmation has no `consequence` (`ToolQuestion.ts:256`).

## Outcomes and their words

Typed outcomes are declared in `permissions`:
- `unanswered { questionId, askedOf, timeoutMs }` — nobody answered in time, neither approver nor operator;
- `declined { by, note? }`;
- `approval-pending { questionId }` — the door's own wait expired but the question stands ([[4a024c48]]);
- `no-approver` — the run cannot wait (`unattended`);
- `mode-unknown` — the mode id is not registered, at mode recording.

`operator-only` is declared by Tagma `invocation` from `callers`. A mode refusal carries that mode's code.

Words. The outcome-words owner is `permissions`: one function per outcome builds the model text on every road. Tagma doors translate the outcome into a `GateRefusal { code, reason, unblock }` with the same words.

What the agent sees:
- native and hosted — a tool result `{ status: 'refused', code, reason, unblock }`;
- `tagma op`, HTTP and MCP — the door refusal with the same code.

For `unanswered` the reason names the action, the duration and who was asked, and unblock says "repeat the action to ask again" and "continue without it". For `declined` — who refused and its note. The question view's call-state outcome is `denied`.

The question closes with `lapsed` status, and the window shows "expired without an answer in 10 min". Today expiry and refusal give untyped `refused` and `cancelled` with text (`ToolQuestion.ts:40-47,193-196`).

The `agent.questionWait` setting is removed: only the declaration names the timeout.

## Adding in one place

- **Mode** — one registration with `strictness` (and `refuses` when it refuses). Any action's verdict under it follows from the rungs. The thread wire and the settings picker take modes from the registry.
- **Condition** — one `Condition` constant in the fact-owning module, with rung and timeout. Actions that raise it list it in `when`, and their prepare raises it. Composition collects conditions from declarations, and one id at two owners fails loading with both names. `agent-running` and `root-in-use` are declared twice today — in `landing/merge/coordinator.ts` and `worktrees/retirement/guards.ts`. They become one declaration at the lower of the two modules or two different ids.
- **Action** — its own declaration with `approval`: an explicit rung, an explicit timeout and conditions. The shared family constant carries the family's.

## Reading the law

- The `read_operations` row gets `callers` (already there) and `approval`: rung, `why`, timeout, conditions with rungs and timeouts. `read_agent_library` shows tools' approval instead of floor capability.
- A tool description gets one line derived from the declaration by one function, e.g. "Asks first under trust and review, waits 10 minutes; under review also when …".
- Handwritten question phrases in tool descriptions (`stop_agent`, `set_agent_model`, `spawn_agent` etc.), in settings descriptions (`agent.approvalMode`, `agent.worktrees`, `agent.delegation`) and in the `graph-refusals` doctrine are removed. Settings describe rungs without listing actions.

## Acceptance criteria

- A `judge` unit test (`packages/agent`) covers every row of the modes table. Separately:
  - two asking causes with 10-min and `'none'` timeouts give a 10-min deadline, and two with `'none'` give waiting with no deadline;
  - a condition raised on `trust` in one action and on `review` in another gives different verdicts in trust.
- Unit test: a fifth mode registered in the test file with `strictness` between trust and review asks actions with the `trust` rung and does not ask with the `review` rung. A mode with `refuses` for mutating actions refuses on the native door and on `tagma op` (together with [[4a024c48]]).
- Composition test: a rung named by no mode, and one condition id at two owners, fail loading with names.
- Door test: prepare raising an undeclared condition is a defect, not `allow`.
- Test: an operation with `callers: 'operator'` refuses the flow with `operator-only` in every built-in mode. The same declaration with the field switched to `'any'` is judged by its `approval`.
- Outcome tests check code and typed fields, not text ([[4f387de2]]).
- `rg`: no `floor`, `PermissionPolicy`, `matchesGlob`, `consent` in `permissions/` and `modes/`; no `questionWait` anywhere in the code.
