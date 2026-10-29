---
id: 01a14bae-6720-7d62-897a-927fda029bcc
title: Operator sets a thread's approval mode — trust, review, or bypass
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b1f8-736b-a67c-1533b9f89e00
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/mode.commands.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/wire/hooks.ts
  - kind: file
    ref: packages/agent/src/modes/builtin.ts
  - kind: file
    ref: packages/chat-ui/src/composerKeys.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/turns.ts
    symbol: TURN_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: birthApprovalMode
---
**Value.** The operator picks how far to trust the agent — from a question before every mutating call to full freedom — with one switch on the thread.

**How.** The `/mode` command and mode cycling in the composer, the `set_thread_authority` operation, the mode at thread birth, the `agent.approvalMode` setting.

**Behaviour.** `trust` asks only about risky acts — a plain child, deleting a thread, archiving someone else's subtree, and a new worktree for a child only at `agent.worktrees: ask` (default `allow`); `review` — also before every call that is not a pure read; `bypass` asks nothing. Each act itself declares the mode it asks from. The mode decides what a thread asks about, not who answers: a child's question goes to its parent in any mode, and the parent's answer is final. A child is born in the parent's mode unless its type carries its own. CLI-thread tool calls are judged by the same mode through a hook. Moving to bypass answers already open confirmations.

**Limits.** A system bound refuses in any mode. A conditional question has a deadline, and a late answer does not permit the call.
