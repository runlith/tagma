---
id: 01a14b6d-b1f5-7253-8157-720e384581fd
title: Parent answers children's approval questions on the operator's grant instead of the operator
ord: 9
---
The operator lets a parent agent answer its children's approval questions so the team does not stand on every confirmation. The operator can answer directly, and then the question closes.

**Grant.** A list of acts (`delete_thread`, `bash`) and condition ids (`outside-subtree`): an act covers all its questions, a condition covers that reason on any act. Set with `/approves` on the parent's thread (Inherit, Nothing, or a choice of acts), with the `set_thread_approves` operation (operator only; `null` — inherit, `[]` — withdraw here and below), or with the `agent.approves` setting (operator only). The nearest list up the parent line decides, otherwise the setting does.

**Route.** A child's question goes to the parent only when every reason behind it is covered by the grant and parent and child stand in the same approval mode; otherwise, and when the parent is archived or the operator has intercepted the thread, the question waits for the operator. Questions the child's own CLI asks (its permission screens, choices) always belong to the parent. The parent gets an approval envelope with the question and the ready call and answers with `answer_approval`: `allow` (otherwise refused with its `note`) or the chosen `value` / `values`. The child's feed shows "Asking thread …, which approves this for its children" and then who answered instead of the operator.

**Limits and refusals.** `answer_approval` refuses someone else's question (`not-the-approver`), an unknown one (`unknown-question`), a wrongly shaped answer (`answer-unoffered`), and an answer the CLI did not accept (`answer-unwritten`, the question stays open).

**Links.** Approval mode; interception by the operator's words; the CLI profile with its own permission mode.

Code: apps/tagma/server/src/threads/approvers.ts, apps/tagma/server/src/threads/contract/wire/operations/approvals.ts#APPROVER_OPERATIONS, apps/tagma/server/src/threads/contract/wire/settings.ts#approves, packages/agent/src/collaboration/collaborationVerbs.ts#ANSWER_APPROVAL, apps/tagma/app/src/lib/features/threads/native/commands/approves.commands.ts, apps/tagma/app/src/lib/features/threads/native/strings.ts
