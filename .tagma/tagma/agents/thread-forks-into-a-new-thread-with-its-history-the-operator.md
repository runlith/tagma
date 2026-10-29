---
id: 01a14b6d-b204-76f1-abfa-cc99d218d60c
title: "Thread forks into a new thread with its history: the operator — from any message, the agent — fork_thread or spawn with fork"
ord: 14
---
A conversation can continue in a new thread with the same history without touching the original: try another path from any point, or hand a copy of the context to another performer.

**Three roads.**
- Operator: "Branch" on a message in the feed (or in the rollback picker) opens a new thread that ends right before that message, with the message's words in the composer; the `branch_thread` operation — the whole history or up to the `before` turn.
- Agent: the deferred `fork_thread` tool forks any thread it reaches, its own included — `carry` (`all`, `none`, the last N turns) or `before` (the history as a rollback to that run would leave it), `title` — the branch's exact name. A branch is independent: not a child, with no automatic report and no management; it is told who it is, carries no tasks, rows, or debts of the source, and works only when written to. A thread mid-turn or on a question is copied as it stands, its open calls answered as they went in the source.
- `spawn_agent` with `fork` / `forkFrom` — a child carrying the parent's history or a thread of its subtree that stays a child (see launching a child agent).

**Limits and refusals.** A transport without history (terminal CLI) — `transport-cannot` / `harness-contract`; a running thread is not branched by the operator (`run-active`); a turn that already went into a summary or was rolled back is unavailable (`rewind-summarized`, `rewind-rewound`). An empty `title` — `title-empty`. A repeat under a key answers with the same branch, a different meaning under the key — `key-reused`.

Code: apps/tagma/server/src/threads/contract/wire/operations/turns.ts#TURN_OPERATIONS, packages/agent/src/collaboration/historyTools.ts#forkTools, packages/agent/src/collaboration/branching.ts, packages/agent/src/collaboration/CollaborationVoice.ts#branchBirth, apps/tagma/app/src/lib/features/threads/native/strings.ts#rewindWords
