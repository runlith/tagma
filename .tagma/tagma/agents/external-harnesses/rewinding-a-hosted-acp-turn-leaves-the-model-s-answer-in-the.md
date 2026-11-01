---
id: 01a19763-3bcc-7226-8ecc-59e1de388e79
title: Rewinding a hosted ACP turn leaves the model's answer in the rebuilt history
ord: 210
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a19561-644d-76b1-8079-9c247761ae92
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/journal.ts
  - kind: file
    ref: packages/agent/src/thread/HistoryAttribution.ts
---
Rewinding a turn of a hosted ACP thread takes out the user's words but leaves the model's answer in the history the next session is built from. Measured on a Muse Code thread (trial server, 2026-11-01): after rewinding the turn that answered `LATER`, the fresh session's `<thread-history>` still ended with `assistant: LATER`, and the model said it had replied LATER.

Cause, read in code: `ProtocolJournal` writes a hosted step's model messages as `{ kind: 'message', payload: { messages } }` with no entry and no step context (`protocol/journal.ts`, `eventsOf`), while the native loop writes them as a `step` event whose `context` names the run. `HistoryAttribution.fold` attributes a message to a run only through `entry.runId` or `context.runId` (or a `context` event of the open run), so these messages belong to no run and `plan()` never cuts them. Every hosted harness (Claude Code, Cursor, OpenCode, Muse Code) shares this journal.

Fix at the producer: write the hosted model messages with the run they belong to, the way native steps do, so rewind, branch and restore cut and restore them with their turn. A defect test drives a hosted turn, rewinds it, and reads the history the next session receives.
