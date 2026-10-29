---
id: 01a17420-8175-7ae5-a28b-a3e7f9ebaf80
title: Thread shows what graph work it does and did there, and an agent launches onto it from a work block
ord: 37
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693cdef49593
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69423f034f23
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6944756614a0
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694b05354451
  - kind: relates
    to: 01a1741f-a3b7-7fc0-bf9a-6e37d7bc5513
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/service/journal.ts
  - kind: file
    ref: apps/tagma/server/src/graph/work/tasks/holding.ts
---
**Outcome.** Opening a thread, the operator sees what graph work it does and did there, and can launch an agent onto that work from a task or spec block. Thread and graph read as one: work lives in the graph, the conversation about it in the thread.

- **Thread header — a "working on" row.** The work the thread holds (`core/holder`) and its parent spec, one row per taken work item. A click opens the block beside, Cmd-click in Knowledge, by the link rule [[d7bc5513]].
- **"What was done" — a right-area tab beside Changes.** Blocks the thread created, changed, and finished, with acts (created, edited, finished, closed), and commits that finished its work. A row opens a block or commit beside. Changes answers "whose code lines are its", this tab "whose knowledge is its".
- **"Start agent on this"** in a work block's menu (page, outline, block's right-area tab). A new thread is born with that work in its task and already holds it: the "working on" row shows from its first turn.

**Why.** The link is one-way now (code reading 2026-10-25):
- from graph to thread — the holder badge on a block row (`WriterBadge`) opens the thread, Journal filters by session;
- from thread to graph — only graph-act cards in the feed ([[05354451]]) and links in text; nobody reads the holder in `features/threads`, and "what the thread did in the graph" assembles only through a Journal filter.

The server already knows everything needed: the holder is written in the node, `query_blocks` selects by it (`assigneeSessionId`), the journal knows every act's author (`GraphJournal.touchedBy`), a work's end keeps the commit. The app never asks about it.

**For all users.** Rows and tab rest on the `core/holder` and `core/work` contracts, not tag names: they work in any catalog, in projects with and without code. In a tagless project with a holder the "working on" row is absent, while "what was done" shows edited blocks of any kind.

**Design.**
- **One server read — the thread's work in the graph.** Owned by `graph`: by the thread's writer sessions (`WriterRegister`, thread-id key) in every copy the thread wrote into, it answers held work with spec parents and the thread's act pages by block with end commits. This projects the same journal and the same holder field; the app has no second output. The reading pages with `limit` and a total.
- **Liveness** — by the copy's graph feed: a frame touching the thread's block or holder rereads the answer. The read never recounts the whole journal per frame: it answers from journal indexes and the holder field.
- **App:** a thread-feature row in the header plus a new right-area view in `features/graph/panes.ts`; both read one repo of this read.
- **"Start agent on this"** bears a thread through the existing birth door with the work in its task, and in the same act the new thread takes the work with a claim operation in its own name. When another live thread holds the work, the act runs the same way work interception runs today: in review mode the operator sees whose work is touched.

**Acceptance (performer checks).**
1. A test of the read through its operation: a thread that took work and edited two blocks in two copies gets the work with its spec parent and both blocks with acts; having finished work with a commit, it sees it in "what was done" with that commit and no longer in "working on".
2. The thread header shows the row only with taken work and updates over the graph feed without reload; click and Cmd-click go through `Opening`.
3. The "what was done" tab opens from the right-area "+" menu and restores with the thread layout.
4. "Start agent on this" bears a thread that holds the work until its first turn; someone else's taken work takes the same path as interception today.

**Out of scope.** The `send_task` assignment's link to graph work is a [[db32beea|separate idea]]: it changes the delegation model and needs the operator's decision.
