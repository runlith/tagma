---
id: 01a14b6d-b1f0-76e7-b81f-50016be85f93
title: Operator's words to a sub-agent make the operator its approver and can be reported to the parent
ord: 8
---
The operator opens a sub-agent's thread and writes into it directly, like any thread. Two things change: approval questions for that thread move to the operator, and the parent can learn that the operator stepped in.

**Approval interception.** While `agent.takeover` is on (default yes), the operator's first word to the child makes the operator its approver: already open questions are redirected, and the parent grant no longer decides for this thread. `/approver default` or `set_thread_approver default` returns the route to the parent grant; `set_thread_approver you` intercepts without words.

**Parent notification.** When enabled for the child, the parent gets a message that wakes it: the operator addressed the child or queued words for it, plus the text of those words; the notification asks to align its instructions and asks no new work. `set_thread_operator_notice` on the parent decides (`true` / `false` / `null` — by the setting) for a specific child, otherwise `agent.operatorNotice` (off by default). Words said before enabling are not delivered retroactively; a disabled notification does not accumulate. A notification on a thread outside its own subtree is changed by an agent only on the operator's word.

**Links.** Approval by the parent; a turn from the composer.

Code: apps/tagma/server/src/threads/turns/reader.ts#ReaderMarks, apps/tagma/server/src/threads/contract/wire/settings.ts#takeover, apps/tagma/server/src/threads/contract/wire/settings.ts#operatorNotice, apps/tagma/server/src/threads/contract/wire/operations/approvals.ts#APPROVER_OPERATIONS, apps/tagma/server/src/threads/contract/wire/operations/catalog.ts (set_thread_operator_notice), apps/tagma/app/src/lib/features/threads/native/commands/approver.commands.ts
