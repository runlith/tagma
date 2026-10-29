---
id: 01a14bae-6720-7d62-897a-927dd673fb57
title: Operator's words to a sub-agent make the operator its approver and can be reported to the parent
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927ef2dc414b
  - kind: supersedes
    to: 01a14b6d-b1f0-76e7-b81f-50016be85f93
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/approver.commands.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/approvals.ts
    symbol: APPROVER_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: operatorNotice
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: takeover
  - kind: symbol
    ref: apps/tagma/server/src/threads/turns/reader.ts
    symbol: ReaderMarks
---
**Value.** The operator steps into a sub-agent's work without breaking the team: that thread's questions, which the parent would otherwise answer, move to the operator, and the parent can learn about the intervention and align its own instructions.

**How.** The operator simply writes into the child's thread. Question routing — `/approver` and `set_thread_approver`; parent notification — `set_thread_operator_notice`; settings `agent.takeover` and `agent.operatorNotice`.

**Behaviour.** The operator's first word to a child makes the operator its approver, and already open questions move over; the route can be returned to the parent or intercepted without words. The notification wakes the parent with the text of the operator's words and asks no new work. Interception is on by default, notification off.

**Limits.** Words said before notification was enabled are not delivered retroactively. A notification on a thread outside its own subtree is changed by an agent only on the operator's word.
