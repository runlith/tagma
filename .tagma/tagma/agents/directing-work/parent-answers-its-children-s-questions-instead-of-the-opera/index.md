---
id: 01a14bae-6720-7d62-897a-927ef2dc414b
title: Parent answers its children's questions instead of the operator, and its answer is final
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927fda029bcc
  - kind: supersedes
    to: 01a14b6d-b1f5-7253-8157-720e384581fd
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/approves.commands.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/strings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/approvers.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/approvals.ts
    symbol: APPROVER_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: approves
  - kind: symbol
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
    symbol: ANSWER_APPROVAL
---
**Value.** An agent team does not stand on every question: the lead answers for the sub-agents it created, as a father for a son, and the operator learns only what the lead was not entrusted with.

**How.** Nothing to enable: the parent answers with `answer_approval`. The operator narrows what the parent answers for with `/approves` on its thread, the `set_thread_approves` operation, or the `agent.approves` setting.

**Behaviour.** A child's question — an approval, an `ask_user`, and a mode question about a CLI child's call — goes to the parent, in whatever modes both stand: the mode decides what a thread asks about, not who answers. The parent's answer is final even when its own mode would ask about the same act. The `approves` list (default `*` — everything) narrows it to acts and conditions, an empty one to nothing; an uncovered question waits for the operator. The nearest list up the line decides, otherwise the setting. The operator is asked by a thread with no parent, a detached one, one with a parent in the archive, one intercepted by the operator, and an `ask_user` with a secret field. A child's own CLI questions — its permission screens — go to the parent. The operator can answer itself at any moment; the child's feed shows who answered instead of the operator.

**Limits.** An answer the CLI did not accept leaves the question open.
