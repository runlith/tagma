---
id: 01a0d139-e7a4-7842-ac63-3b2516933791
title: "A native agent waiting on a question shows no question in list_agents: the directory reads the ask only from a harness facet"
ord: 84
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d138-dd38-7b1e-b0c1-420ab95fc457",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d136-c1a6-7dbb-b477-8dc4f943c3ed
  - kind: waits-on
    to: 01a0d136-c587-7a98-89fb-a1b58847ca6b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/store/directory.ts
    symbol: ThreadDirectoryStore
---
`list_agents` and the collaboration roster show a waiting agent's question only for a foreign CLI (harness) thread. A native Tagma agent waiting on a question reads `awaitingQuestion: true` with no question text. So a parent, or the operator reading the roster, has to open the thread to learn what it asks.

**Where.** In `apps/tagma/server/src/thread/ThreadDirectoryStore.ts` the kernel-driven branch sets `askPrompt: null` unconditionally. The harness branch reads `facet.question.prompt`. The pending question of a native thread is already stored: `thread.pendingInteraction`, which `ThreadStore.summaries` selects, as the spec root [[f943c3ed]] found. Task [[8847ca6b]] wires the same reading into the thread list row as `ask`. Reuse that reading, so both readers name the same question.

**Done when:**
- a native thread waiting on a question answers its question text as `askPrompt` in the directory row;
- `list_agents` prints it;
- the harness branch is unchanged;
- a test covers a native waiting thread's prompt;
- the owner's claims are reconciled.
