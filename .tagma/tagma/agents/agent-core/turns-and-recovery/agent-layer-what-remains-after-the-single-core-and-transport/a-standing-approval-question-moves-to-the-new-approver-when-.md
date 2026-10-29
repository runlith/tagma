---
id: 01a151df-e920-73d7-9b09-09d80c12ca5d
title: A standing approval question moves to the new approver when the agent.approves setting changes and when a thread detaches
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-f13f-7600-9274-8b6e02ae3a9c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/detachment.ts
  - kind: file
    ref: apps/tagma/server/src/threads/turns/adjustments.ts
---
A standing approval question moves to the new approver when the agent.approves setting changes and when a thread detaches. `Questions.reroute` is recalculated by a mode switch, `set_thread_approves`, `/approver`, and the operator's words to a child (`threads/turns/adjustments.ts`, `threads/turns/reader.ts`). It is never called by the `agent.approves` setting write (`Settings.write`) and `detach_thread` (`threads/collaboration/detachment.ts`). A child's question stays with a parent whose grant came from the setting and is already withdrawn, or with a parent the thread detached from, and that parent's `answer_approval` is still accepted.

To do: `agent.approves` writes (project and user), detaching, and returning under a parent redirect the standing questions of affected threads. The work walks threads with standing questions, not every project thread.

Proof: `composition/testing/http/approver.stest.ts` after a review fix — 4 pass, 0 fail, 55 assertions, 37.97 s wall. The new scenario checks X(review) → Y(review) in different projects, the grant from only a user or project `[bash]` setting, two simultaneously open questions and closing the first: the `[]` setting moves the remaining question to the operator, `answer_approval` from X refuses `not-the-approver`. `detach_thread` gives the same refusal; `detached:false` returns the question to X, and X answers. The fixture no longer passes another provider's model subscription-account. Routing reads open question records apart from the slot; moving the next question into the slot is fixed separately in [[9c5f7df9]]. Per review both sample branches gained partial indexes: `thread_entry` (history) and `native_thread` (entity), with declared `heavy.json`. The index builds with one read of each table; snapshot bodies and outside files in history — 0 bytes. A short readonly sample 2026-10-19: `max(rowid)` 3265947 and 5283 respectively (not row counts); the whole base — 13843615744 bytes by page_count, not these tables' sizes. The test fixed the actual SQL of the public Settings.write: EXPLAIN confirms both partial indexes, explicitly picked with INDEXED BY so the plan never depends on SQLite stats. The single followApproves subscription is created in threadEngineLayer after MachineStore opens with all migrations and captures that db; import rollout and old copies never route the request into an unmigrated base. A started online backup stopped and its partial files removed; building indexes on the operator base was never measured.
