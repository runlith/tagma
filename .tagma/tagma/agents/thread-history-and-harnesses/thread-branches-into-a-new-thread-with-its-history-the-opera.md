---
id: 01a14bae-6720-7d62-897a-9283445ee8a6
title: "Thread branches into a new thread with its history: the operator — from any message, the agent — spawn_agent with fork"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b204-76f1-abfa-cc99d218d60c
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/native/strings.ts
    symbol: rewindWords
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/turns.ts
    symbol: TURN_OPERATIONS
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadBranch.ts
    symbol: makeThreadBranch
---
**Value.** A conversation is tried another way without touching the original: from any message, or with a copy of the context at another performer.

**How.** Branch on a message in the feed and the operator's `branch_thread` operation; the agent's `spawn_agent` with `fork`.

**Behaviour.** The operator's branch ends right before the picked message, with its words in the composer. The agent copies the history of its own or any addressable thread — all of it, the last N turns, or up to the picked run — into a new agent with a task: a child in its own team or, with `link: root`, an independent root owing an answer only for that task. A last-N cut counts runs, keeping every input delivered within each retained run in both model history and transcript. A native fork keeping the source identity uses its frozen profile even when the definition file has since changed. Copied tasks, lines, and debts stay with the source. A thread mid-turn is copied as it stands, except a thread whose conversation is held by a vendor session — a terminal CLI or an ACP agent: the operator's fork of it takes the conversation up to the running turn, and the turn stays with the source.

**Limits.** Only the thread itself branches a running thread; a turn gone into a summary or rolled back is unavailable. Branching by an agent is a birth: delegation judges it.
