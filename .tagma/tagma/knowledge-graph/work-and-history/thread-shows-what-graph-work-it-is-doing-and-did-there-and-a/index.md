---
id: 01a17451-1d4f-7646-baf2-34ee80851ca1
title: Thread shows what graph work it is doing and did there, and an agent launches onto it from a work block
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693cdef49593
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69423f034f23
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6944756614a0
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a70614903d
  - kind: relates
    to: 01a17420-8175-7ae5-a28b-a3e7f9ebaf80
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/ThreadWork.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/work/WorkSections.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/WorksOn.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/work/tasks/sessionWork.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/history.ts
    symbol: HISTORY_PAIRS
---
**Value.** Opening a thread, the operator sees what graph work it holds and did there, and launches an agent onto it from a work block. What used to assemble only through a Journal filter by session now reads as one.

**How.**
- Thread header: after the title — the work it holds and the spec it stands under; "+N" when there are several opens their list.
- Work tab of the right area ("+" menu, beside Changes): Works on — held work with spec, Did — blocks the thread created, edited, finished, or closed, with the commit that finished the work; "Show more" pages on.
- "Start agent on this" in a work block or spec menu: on the block page, in outline, in the block's right-area tab, and in the right-click menu on a block link.
- The server answers with one `read_thread_work` read; launching the agent is `create_thread` with `work`.

**Behaviour.**
- Work and spec follow the `core/holder`, `core/work`, and `core/spec` contracts, not tag names: in a project without tags with a holder there is no header row, while Did shows edited blocks of any kind.
- Reading follows the graph copies where the thread works: its home, its current roots, and every copy where it changed something — a home worktree or a foreign project, earlier ones too, while their checkout stands. Handover at thread end takes the same set, so the tab never shows work the thread end will not hand over. A copy that failed to open is named separately, the rest answer.
- The end commit shows by hash and subject, like a feed commit link.
- Row and tab are live: the server keeps one work feed of the thread across all its copies, header and tab of one thread share it, and a frame about the thread's own act or about an edit to a shown block or spec rereads the answer; the thread run's end and start reread it too — that is how a copy the thread first entered appears. Unreadable work shows in the header in words, and a feed refusal rereads the answer so it shows what does not read.
- "Start agent on this" is offered exactly where thread birth will take it: a block with a holder or a spec, unfinished.
- A click opens a block or commit beside, Cmd-click in Knowledge or Git, by the general link rule.
- A thread born on work with a holder takes it in its own name before its first turn, and its first turn opens on it; someone else's taken work is intercepted the same way as `claim_block`, and in review mode the agent needs consent for it. Interception goes only to the holder the consent saw: when the work already passed to another, birth refuses. When taking the work or opening the first turn failed, the born thread deletes itself; when deletion failed too, the refusal names the thread left without work.

**Limits.**
- Copies where the thread worked before they started being remembered are visible only when it changes something there again: from a foreign project only the last one was remembered, and from home worktrees beside the current root — none.
- "Start agent on this" in the link menu is offered for a graph-copy block open on screen; another copy's block launches from its own page.
