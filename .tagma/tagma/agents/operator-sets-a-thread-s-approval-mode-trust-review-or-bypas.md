---
id: 01a14b6d-b1f8-736b-a67c-1533b9f89e00
title: Operator sets a thread's approval mode — trust, review, or bypass
ord: 10
---
The operator sets what a thread asks about before acting. A mode is a strictness rung: each act declares the rung it asks from, and the mode asks everywhere its rung reaches.

**Modes.** `trust` (default) asks only about acts and conditions of the trust rung — for example a new worktree for a child, a plain child, deleting a thread, archiving someone else's subtree; the rest goes through. `review` asks wherever trust does, and before every call that is not a pure read. `bypass` asks about nothing; a system bound still refuses. The mode catalog is extensible: an unknown mode refuses with `mode-unknown`.

**How.** The `/mode` command and Shift+Tab in the composer (cycling modes); the `set_thread_authority` operation (operator; changes the mode of subsequent calls); `approvalMode` at `create_thread`; the `agent.approvalMode` setting — the mode a project thread is born in. A child is born in the parent's mode unless its type carries its own (a plugin agent is `trust`). CLI-thread tool calls are judged by the same mode through a hook (`judge_harness_call`).

**Limits.** A conditional question has a deadline (for collaboration conditions — 10 minutes); an expired question is dropped, a late answer does not permit the call. Moving to bypass answers already open confirmations. A question can go to the parent instead of the operator — see approval by the parent.

Code: packages/agent/src/modes/builtin.ts, apps/tagma/server/src/threads/contract/wire/settings.ts#birthApprovalMode, apps/tagma/server/src/threads/contract/wire/operations/turns.ts#TURN_OPERATIONS, apps/tagma/app/src/lib/features/threads/native/commands/mode.commands.ts, packages/chat-ui/src/composerKeys.ts, apps/tagma/server/src/external-harnesses/contract/wire/hooks.ts
