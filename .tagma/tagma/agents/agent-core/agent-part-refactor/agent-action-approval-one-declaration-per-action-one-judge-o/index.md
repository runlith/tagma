---
id: 01a11c26-7d19-7b9a-8bcc-295722b5531d
title: "Agent-action approval: one declaration per action, one judge on every road, the operator or parent answers"
ord: 35
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cd1fb39e560
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cd3bb429da3
sources:
  - kind: dir
    ref: packages/agent/src/permissions
  - kind: file
    ref: apps/tagma/server/src/invocation/consent.ts
---
Goal: every agent action in Tagma obeys one approval rule, the same on every road.

- **Availability.** Whether the action is available to agents is decided by one operation field, `callers`. Modes are unrelated to it.
- **Approval.** An available action declares once and explicitly from which mode it asks, on which named conditions it asks additionally, how long it waits for an answer, and what it shows in the question.
- **Judge.** One judge reads that declaration on every road and gives one verdict.
- **Who answers.** The operator answers. A parent agent answers instead only when the operator explicitly granted it an approval grant for actions of that kind and the parent stands on the same rung as the child. An operator who wrote to a sub-agent directly becomes the one that sub-agent asks.
- **System limits** — spawn depth, budget and slots, switched-off delegation — are typed refusals in every mode, not approval.

## What the operator gets

- The answer to "will agent X ask in mode M and how long will it wait" stands in X's declaration. It is shown by `read_operations`, the agent catalog and the row in the tool description.
- The question says why it was asked, who it asks and when it expires. After the answer it says who answered.
- Work does not stand while the operator sleeps:
  - a parent with a grant approves instead;
  - a question with a timeout refuses with the typed `unanswered` cause, and the agent moves on;
  - spawn past the limit refuses at once instead of waiting for an answer.
- Every approval given instead of the operator is recorded and visible in both flows.

## Decided by the operator

1. **Spawn.** Spawn past the depth, budget or slot limit and spawn with delegation off refuse at once with a typed code in every mode, including bypass. That is not approval ([[4946aca5]]). Host slots are included by the same decision as the same system fact.
2. **Timeout.** Every declaration names the timeout explicitly: a duration or `none`, i.e. waits for an answer. There is no shared value, `agent.questionWait` is removed ([[2ebe1a79]]).
3. **Operator operations.** An operator operation or one available to agents is one `callers` field, unrelated to trust, review and bypass. Operator-owned are those the operator keeps to itself. Any becomes available by switching that field, and its approval is declared in advance ([[2ebe1a79]]).
4. **Approval grant.** A parent's right to approve is a separate grant, not the right to perform the action. A parent approves a child's X action only when explicitly granted actions of that kind; with no grant the question goes to the operator. One rung: a trust parent approves for a trust child ([[52a9ca4e]]).
5. **`agent.worktrees`** affects trust only. At `allow` a new worktree is made without a question, at `ask` trust asks. Bypass does not read the setting and executes. Review asks like about any non-pure read ([[4946aca5]]).

## Now (at `4681dc8387`)

The operator is asked by two parallel mechanisms.

1. **Permission floors.** `PermissionPolicy { id, verdict, tools, subjects, reason, lapses }` declared in `permissionFloor` capability declarations:
   - `graph`: `settings-write`, `command-rule-write`, `graph-crossing`;
   - `threads`: `archive-beyond-subtree`, `delete-ends-a-thread-for-good`, `pin-rearranges-the-readers-list`, `folders-rearrange-the-readers-list`.

   They are judged by `askedBy`/`deniedBy` (`permissions/floor.ts`) inside the modes' verdicts (`modes/builtin.ts`), and the glob compiles on every check (`matchesGlob`).
2. **Consents.** `Consent { id, label, fact, lapses }` is built by the operation prepare at runtime and passed as a `consent://<id>` subject (`consentSubjects`). That is 31 ids in about 25 places, the full table in [[4946aca5]].
   - On the native door consents are judged by the mode verdict.
   - On `tagma op`, HTTP and MCP they are judged by `consentFor` (`invocation/consent.ts`). The question sits through `ConsentSeats`, and that port is filled by `HarnessPermissions.consent` (`composition/http/handlers.ts:144`). So the question is asked only in a terminal CLI facet with a live session. An ACP flow and a native flow get a refusal, and a native flow is offered to call the operation with its tool.

Around these mechanisms:

- **Operator operations.** 76 operations with `callers: 'operator'` reach the agent through the `operator-operation` consent and through the floor record naming the operation (`c2723c1240`): trust and review ask, bypass passes.
- **Trust after `f7841cfb16`.** Trust asks only by floors, while consents ask only in review. So some words diverge from behavior. Under trust, without a question, pass:
  - what `agent.approvalMode` says "trust asks… sweeping a shared checkout";
  - a new worktree, of which `agent.worktrees` says "approves each one under review and trust";
  - spawn at `agent.delegation` off, of which the setting says "spawn and fork refuse";
  - spawn past limits, of which the `spawn_agent` description says "asks the operator first".
- **Timeouts.** Those are `lapses` on a policy or consent plus the `agent.questionWait` (10 min) setting, from which `reader.withinMs` is built. Expiry on the native and hosted road gives an untyped `{ status: 'refused', reason: 'no answer in 10 minutes' }`. `tagma op` after the door's 50 s wait (`CONSENT_WAIT_MS`) gives `consent-required`.
- **Questions** lie in four stores:
  - the native flow's `pendingInteraction` slot;
  - hosted-run transcript records plus `Deferred`;
  - the foreign session's `facet.question` with `hook`, `consent`, `screen`, `protocol` sources;
  - `harness_consent` receipts.
- **Built-in modes are wired into two roads.** `ModeVerdicts` defaults to `builtinModes` — the door after the question answer and at an accepted run (`ThreadAgent.ts:485`). `external-harnesses/asks/decision.ts` calls `permissionOutcome([], …)` with built-in modes by default. `ApprovalModes` is a `Context.Reference` with a process-global default. The mode-id schema accepts any non-empty string. All this was found by the [[629ac667]] review.
- **Answer.** Only the operator answers a native question (`answer_question` is an operator operation). A parent learns of a child's question from the run stage in `list_agents` or from the terminal CLI's `envelope:ask`. `answer_ask` lets any flow answer a terminal CLI's vendor question.

## Dictionary

- **Action** — one call judged by Tagma. That is a Tagma operation over any door (native tool, `tagma op`, HTTP, socket, MCP), an agent-world tool (`bash`, `edit`, `webfetch`…), an MCP-server tool, or a foreign-CLI tool call.
- **Availability** — an operation's `callers` field: `'operator'` (the operator keeps it to itself), `'any'` (available to agents) or `'thread'` (flow protocol).
- **Approval declaration (`Approval`)** — a required part of the action's own declaration. It explicitly says from which rung the action asks, how long it waits (a duration or `none`), why, and which conditions it may raise.
- **Condition (`Condition`)** — a named fact about the specific call: outside the subtree, work at another session… It is declared once, with rung and timeout, by the module owning the fact, and an action's prepare raises it with fact text.
- **Rung.** Modes are ordered by strictness: `bypass` < `trust` < `review`. "Asks from trust" means "in trust and in every stricter mode".
- **Verdict** — `allow`, `ask` or a typed refusal.
- **Approver** — the one being asked: the operator or a parent flow.
- **Approval grant (`approves`)** — the list of actions and conditions a flow approves for its children instead of the operator. Only the operator grants: on a flow or on a tree root.

## Architecture

Layers bottom-up; each part in its own child.

- `packages/agent/src/modes`. The mode descriptor gets `strictness` and an optional `refuses`. The registry stays the single source of modes, with no process-global default ([[2ebe1a79]]).
- `packages/agent/src/permissions` — the lowest owner per [[144dfedc]]. It holds:
  - `Approval`, `Condition` and `Raised` types;
  - the pure `judge` function;
  - the `ApprovalView` question view;
  - the `unanswered` and `declined` typed outcomes and their words ([[2ebe1a79]]).
- `packages/agent/src/agent/door`. `ToolAdmission` calls the door's verdict port ([[9bc6e931]]), which `judge` fills with the server registry; `ModeVerdicts` is removed ([[4a024c48]]).
- `packages/agent/src/thread/interaction` — one `Questions` from [[fb39e560]]. It holds every road's approval questions, their deadlines and answers with author, and declares the `Approvers` port ([[4a024c48]], [[52a9ca4e]]).
- `packages/agent/src/collaboration` holds:
  - question delivery to the parent;
  - the `answer_approval` tool;
  - tree conditions;
  - spawn-limit refusals ([[52a9ca4e]], [[4946aca5]]).
- Tagma `invocation` — one admission: first the caller's availability and identity (`callers`), then prepare, `judge` and the question through `Questions`. `consent.ts` and `ConsentSeats` are removed ([[4a024c48]]).
- Operation-owning modules hold `approval` in the operation declaration and their conditions in their own `contract/wire` (rules [[edea5454]] and [[e090f46d]]).
- Tagma `threads` holds:
  - the `approves` grant and takeover in `thread_mandate`;
  - the `agent.approves` and `agent.takeover` settings;
  - the `set_thread_approves` and `set_thread_approver` operations;
  - filling the `Approvers` port ([[52a9ca4e]]).
- Tagma `external-harnesses`. The vendor adapter declares its tools' approval, and judge and question are shared ([[4a024c48]]).
- The app. The `/approver` and `/approves` commands, and the confirmation window shows causes, the approver and why that one, the deadline and the answer author ([[52a9ca4e]]).

One call's path:
1. When `callers` does not admit agents — `operator-only`.
2. Prepare raises conditions; the owner's system limit refuses with its own code.
3. `judge(approval, raised, mode)` gives one of three:
   - `allow` → execute with admitted conditions;
   - `ask` → `Questions` places a question with view, approver and deadline → answer with author → execute once or a typed refusal;
   - refusal → typed refusal.

## Decisions

1. **A mode is a strictness rung, and an action's declaration names one rung.** Rejected: a "mode → verdict" map in every declaration: a new mode would rewrite ~330 declarations or introduce a default, i.e. the same rung.
2. **Conditions are declared statically at the fact owner and listed in the raising action's declaration; prepare only raises them with the fact.** Rejected: a consent with a runtime threshold: the law stays in 25 code places and does not read from the catalog.
3. **Availability is one `callers` field, mode-independent.** Approval is declared on every operation, including operator ones, so opening an operation to agents is one field change.
4. **No defaults in the declaration.** An action names rung and timeout explicitly; the shared family constant carries the family's. Mechanical migration repeats today's behavior: pure reading — `never`, the rest — `review`, `none`.
5. **A question waits the smallest duration among asking causes; `none` does not shorten the deadline.** So today's behavior holds in every row of the migration table.
6. **`judge` is one pure function.** Roads differ only in how the caller waits for the answer: run parking, HTTP-call waiting to the door deadline, CLI hook. That is a transport property, not a second copy of the rule.
7. **The approval grant is separate from the right to perform the action.** Its selectors are an action or a condition. The approver flow holds it, it inherits along the spawn line like `delegation`, and only the operator grants. The parent is the approver only when every asking cause is covered and its mode equals the child's mode.
8. **The current approver answers, and the operator always does** ([[0f144655]]). There is no machinery against agent escalation ([[06e41b6f]]): the control is the grant, takeover and recording.
9. **Law words in tool descriptions, settings and doctrine are derived from the declaration in one line, not handwritten** ([[51c66cb6]]). Today they already diverged from behavior.

## Parts

- [[2ebe1a79]] — availability, declaration, conditions, mode-rungs, judge, question view, timeouts and typed outcomes.
- [[4a024c48]] — every road calls the judge and places the question in one store; the consent mechanism is removed.
- [[52a9ca4e]] — who is asked: the operator, the parent on grant, operator takeover, commands, recording.
- [[4946aca5]] — a table of all floors and consents (declaration, condition or refusal), stored questions, receipts, settings and `thread_mandate`.

## Boundaries with neighboring specs

This spec is wider than [[6433136a]]: it also changes `invocation`, all module operation declarations, `external-harnesses`, `threads` and the app. Its core is in `packages/agent`, and it closes the F6 "modes and policy" finding to the end.

- [[fb39e560]] owns `Questions`. This spec adds to the approval question causes, approver, deadline from the declaration and author, plus a standalone question with an action key for roads without a run. Approval questions of the `tagma op` and CLI-hook roads enter its one store.
- [[bb429da3]]. The mode registry stays, the descriptor changes: instead of `verdict(call, floor)` — `strictness` and `refuses`. Its "fourth mode with one registration, deny on both roads" criterion moves to [[2ebe1a79]] in new form.
- [[7c54d3ed]]. The hosted confirmation is a `ThreadHosting` question, and its verdict is given by `judge`.
- [[8451c5c9]]. The definition's grant and `deny` stand before the judge, and `unconditionalDenial` leaves with the floors. Definition tools' grant and the approval grant are different things with different names (`grant` and `approves`).
- [[9bc6e931]] — the door's verdict port; `judge` fills it.
- The same change rewrites the [[fe7e09a3]] notes (the approval answer outlives the MCP call) and [[54c5fcd2]] (an operator operation refuses the agent, and one field opens it).

## Order

| Cut | Finishes after | Does |
|---|---|---|
| [[2ebe1a79]] and [[4946aca5]] (declarations and refusals) | — | Explicit declarations, conditions, mode rungs and spawn-limit refusals in one cut per [[acb620dd]]. Floors and consents become declarations or refusals, all roads call `judge`, and the current stores place the question until [[4a024c48]]. |
| [[4a024c48]] | [[fb39e560]] (task [[a5e5740d]]), [[7c54d3ed]] | One question store on all roads; removal of `ConsentSeats`, `harness_consent` and `hook`/`consent` questions in the facet; stored-question migration. |
| [[52a9ca4e]] | [[4a024c48]] | Approver, approval grant, takeover, commands. |

## Acceptance criteria of the whole work

1. `rg` over `apps/tagma/server/src` and `packages`, except `archive/`, finds no: `Consent`, `consentSubjects`, `consentsOf`, `consentFor`, `consented`, `ConsentSeats`, `ConsentRoute`, `ConsentUntil`, `PermissionPolicy`, `permissionFloor`, `askedBy`, `deniedBy`, `matchesGlob`, `lapses`, `questionWait`, `REVIEW_RULE`, `harness_consent`, `consent-required`, `consent-denied`, and no `builtinModes` or `defaultValue` in `ApprovalModes` outside built-in mode registration.
2. The judge test covers every row of the modes table from [[2ebe1a79]] ([[2ebe1a79]]).
3. One action in one mode gives one verdict and one question record on every road from the [[4a024c48]] table ([[4a024c48]]).
4. A timeout on every road gives `unanswered` with the question id, approver and duration, and the question closes with `lapsed` status ([[2ebe1a79]], [[4a024c48]]).
5. Spawn past every limit and with delegation off refuses with its own code in trust, review and bypass, with no question ([[4946aca5]]).
6. The approval grant, one rung, takeover and commands behave per the [[52a9ca4e]] scenarios ([[52a9ca4e]]).
7. A store with open questions of all kinds answers after migration with the same ids ([[4946aca5]]).
8. `read_operations` shows `callers` and every operation's approval. Two owners with one condition id and a rung named by no mode fail composition with both names.

## What the operator checks

That is not a task-closing condition.

- Scenario X(trust) → Y(trust). The operator gives X a grant with `/approves bash`. Y's `bash` in trust asks X, X answers, Y continues, and Y's feed says "approved by X instead of you". Y's `delete_thread` with no grant asks the operator, and the window says why.
- The operator writes to Y. Y's next question comes to the operator, the window says "you — since you wrote to it". `/approver default` returns questions to X.
- Spawn past depth in bypass refuses with `depth-exhausted`.
- The confirmation window says why it asks, who it asks and until when. An expired question shows as expired.
- A terminal thread in review mode asks about `Bash` through the same window.
- On several actions from [[4946aca5]] (`delete_thread`, `write_setting`, `archive_thread` outside the subtree, `bash`, `spawn_agent` with `worktree: new` at `agent.worktrees: ask`) trust, review and bypass behave per the table.

## Proposals the operator has not yet accepted

1. **Takeover covers only the flow the operator wrote to.** Its children route on their own. The alternative is takeover over the whole subtree.
2. **Defaults.** `agent.approves` is empty, i.e. the approver is the operator. `agent.takeover` is on.
3. **Conditions whose words promise a question in trust but today ask only in review.** The proposal is `trust`:
   - `shared-checkout-sweep` (`bash`) — 10 min;
   - `mode-withheld` (`create_thread` with `approvalMode`) — `none`;
   - `command-ceiling` (`change_command_limit` past the command-rule ceiling) — `none`.

   The alternative is to leave `review` and rewrite the words.
