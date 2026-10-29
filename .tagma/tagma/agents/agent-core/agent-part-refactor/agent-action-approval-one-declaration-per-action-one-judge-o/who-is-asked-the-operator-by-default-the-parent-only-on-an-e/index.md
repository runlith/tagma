---
id: 01a11c26-7d19-7b9a-8bcc-295a52a9ca4e
title: "Who is asked: the operator by default, the parent only on an explicit approval grant on the same rung, interception by the operator's words"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/delegation.commands.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/mandate.ts
  - kind: file
    ref: apps/tagma/server/src/threads/turns/reader.ts
  - kind: file
    ref: packages/chat-ui/src/ToolConfirmation.svelte
---
Goal: every approval question has an approver — the one being asked. By default that is the operator. A parent agent becomes the approver of its child's question only if the operator explicitly granted it approval for actions of that kind and both stand on the same rung. The grant is a separate right, unrelated to the right to perform the action: a trust parent that would itself ask before doing X can approve X for a trust child under a grant. With no grant the question goes to the operator. An operator who wrote to a sub-agent directly becomes its approver until returned with one command. Every approval given instead of the operator is recorded and visible.

## Operator scenario

X (trust) starts Y (trust). Y wants Z, which asks in trust. The operator sleeps seven hours. The operator granted X a grant for Z, for X, or for the root of its tree in advance. Then Y's question reaches X, X answers, and Y continues. With no grant for Z the question waits for the operator.

## Approval grant

**What is granted.** A list of `approves` selectors:
- an action name (an operation or tool, e.g. `delete_thread`, `bash`) covers any question of that action, for whatever reason it asked;
- a condition id (e.g. `outside-subtree`) covers the condition-cause on any action.

A question is covered when each of its asking causes is covered ([[2ebe1a79]]): the action's own rung by action name, a condition by its id or action name.

**Where it is held.** The grant is held by the approver flow, i.e. the parent, in `thread_mandate.approves`:
- `null` — inherit;
- a list, including empty — its own value.

A flow P's effective grant is its own; when absent, the nearest own up the spawn line; when neither, the `agent.approves` setting (project or user, a list). The same resolves `delegation`. Hence two scopes:
- a grant on the root covers the whole tree: every parent in it approves for its children;
- a grant on a flow covers it and below. An empty list on a flow revokes an inherited grant.

**Who grants.** Only the operator:
- the `set_thread_approves` operation (`callers: 'operator'`, socket door);
- the `agent.approves` setting, marked `operatorOnly`, like the operator's other choices.

There is no separate machinery against agents granting grants themselves ([[06e41b6f]]): the operation is operator-owned by its `callers` field.

**One rung.** A parent is the approver only when its mode matches the child's mode at routing time: a trust parent approves for a trust child. With different modes the question goes to the operator.

## Who is asked

Flow C's question approver is computed at placement and recomputed on every takeover, grant, mode and parent change:

1. If C is taken over (`takenOver`) — the operator.
2. Otherwise the parent P, when all hold:
   - P stands (not deleted, and C not detached via `detach_thread`);
   - P's mode equals C's mode;
   - P's effective grant covers the question.
3. Otherwise — the operator.

The operator can answer — always, any question ([[0f144655]]) — and the current approver flow. Everyone else gets `not-the-approver`, checked at answer time. The route goes only to the parent, so there is no cycle or self-approval by construction: a flow is never its own question's approver. That is structure, not guardrails.

## How the parent is asked

- `Questions` informs the approver.
  - The operator — as today: the attention list and push.
  - The parent — collaboration delivers an envelope with an `approval` intent: question and flow ids, the question kind in words ([[2ebe1a79]]), the deadline and how to answer. An idling parent opens a turn, a working one reads the envelope on its next step.
- The parent answers with `answer_approval { threadId, questionId, allow, note? }`. That is a flow-protocol operation (`callers: 'thread'`), a `peers` capability tool, available over MCP too. Its own approval is `asksFrom: 'never'`: asking the operator about an answer instead of the operator is meaningless.
- A parent with a non-empty effective grant sees it in its instructions in one collaboration-section line: what it approves for its children. It also says: decide as the operator would; the operator may answer itself. The words belong to collaboration.
- Every routed question wakes the parent for at least one model step. That is the price the grant picks.

`answer_question` stays the operator's operation and answers any question, including `ask_user`. `answer_approval` answers only approval questions whose approver is the caller.

## Operator takeover

- The operator writes to a flow with a parent — `start_turn`, `queue_turn`, `steer_turn`, i.e. where `ReaderMarks.spoke` (`threads/turns/reader.ts`) sends the parent an `operatorNotice`. When `agent.takeover` is on, the flow becomes `takenOver`.
- The flow's standing questions move to the operator: they appear in the attention list and in push. The parent's late answer refuses with `not-the-approver`.
- There is no "take control" button ([[0f144655]]): takeover is the consequence of the operator having written.
- To return: `/approver default` removes the takeover. Switched-off `agent.takeover` no longer sets it on the operator's words.
- **Proposal (the operator has not decided):**
  - takeover covers only the flow the operator wrote to; its children route on their own;
  - `agent.takeover` is on by default.

## Switches and interface

- **Settings.**
  - `agent.approves` — "What the parent approves for its children instead of you": a list of actions and conditions. **Proposal:** empty by default, i.e. the approver is the operator.
  - `agent.takeover` — "Once you write to a sub-agent you become its approver": on | off.
- **`/approver`** in the flow composer also works while the confirmation window stands:
  - `You` — takeover;
  - `Default` — remove the takeover and ask on the parent grant.

  It writes `set_thread_approver` — the operator's operation on the socket door.
- **`/approves`** in the flow composer opens the choice of what that flow approves for its children. The list is actions and conditions that ask in the flow's mode, plus `Inherit` and `Nothing`. It writes `set_thread_approves`.

  Files are `features/threads/native/commands/approver.commands.ts` and `approves.commands.ts`, next to `delegation.commands.ts`.
- **The confirmation window** (`ToolConfirmation` in chat-ui) names who is asked and why:
  - "<parent> — it approves `bash` for its children";
  - "you — <parent> holds no grant for `bash`";
  - "you — <parent> is in review, and this flow is in trust";
  - "you — since you wrote to it".

  The window also hints `/approver` and the deadline: "refuses at 15:20 without an answer". After the answer — who answered.
- **Thread wire.** `authority` gets:
  - the effective approver and its cause (takeover | parent grant | no grant | different modes | no parent);
  - the flow grant: its own value, the effective value and its origin (own | line flow | setting), as with `delegation`.
- **Attention list.** The waiting row names the approver. Push leaves only when the approver is the operator.

## Recording and visibility

- The answer in `Questions` carries `by` (the flow id that answered instead of the operator) and `note`. No `by` means "the operator answered", and the writer writes it so: one form, not a reading of the old one.
- **Child feed.** "Approved by <parent> instead of you" with a link to the flow. On refusal — who refused and the note. On `declined` the child model gets `declined` with `by` and the note ([[2ebe1a79]]).
- **Parent feed** — its `answer_approval` call: the child, action summary, decision.
- **Flow-evidence reading** (`read_thread`) picks approvals over the subtree: the action, when asked, the approver, who answered, when, the decision.

## Storage

`thread_mandate` gains a drizzle migration ([[4946aca5]]):
- `approves` — a JSON selector list or null;
- `taken_over` — boolean, false by default.

The `Approvers` port is declared in the package's `thread/interaction` ([[e090f46d]]). Tagma `threads` fills it from `thread_mandate`, the line, modes and settings.

## Acceptance criteria

- Package conformance with the `Approvers` port for X (trust) → Y (trust) with X granted `[bash]`:
  - Y's `bash`, asking in trust, places a question with approver X;
  - X gets the envelope;
  - `answer_approval allow` from X executes Y's call exactly once;
  - the record carries `by = X`;
  - `answer_approval` from Y on its own question and from sibling Z refuses `not-the-approver`;
  - the operator's `answer_question` answers at any time.
- Routing test:
  - an action with no grant (`delete_thread`) goes to the operator;
  - the `outside-subtree` condition on `move_thread` goes to X on grant `[outside-subtree]` and to the operator on grant `[bash]`;
  - a question with two causes, the grant covering one, goes to the operator;
  - X in review and Y in trust goes to the operator;
  - a grant on the root works for the grandchild through its parent;
  - X's own empty list revokes an inherited grant;
  - a deleted or detached parent gives the operator.
- Test: a parent refusal gives Y a typed `declined` with `by = X`. The deadline expires on a routed question the same as on the operator's question.
- Test in Tagma `threads`:
  - the operator's `start_turn` on Y takes it over;
  - Y's next question goes to the operator;
  - the standing question moves to the operator, and X's answer refuses;
  - `set_thread_approver(Y, default)` returns the approver to X;
  - with `agent.takeover` off, the operator's words set no takeover;
  - taking over Y does not change its children's routing.
- Wire test: the approver view names the cause in all five cases, and the grant view names the origin.
