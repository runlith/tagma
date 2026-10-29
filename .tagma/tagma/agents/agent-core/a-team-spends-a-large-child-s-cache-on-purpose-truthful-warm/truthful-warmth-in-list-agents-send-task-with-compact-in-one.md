---
id: 01a0da9c-e1b7-7ae7-becb-78ed9b1edfa6
title: Truthful warmth in list_agents, send_task with compact in one unit, the compact_agent answer, and the team prompt's order by warmth and task size
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0da9d-27e0-7256-93f4-6a00ba6dbe9a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0da9c-b613-74a3-844d-566d021c93b2
---
Implements §4.1–4.3 of [[021c93b2]], with acceptance 1–6.

Start at `packages/agent/src/collaboration/ThreadDirectory.ts#heldPrefix`: warmth there is judged against the reading itself with `account: null`. It must become the server's thread-list verdict (`apps/tagma/server/src/harness/wire.ts#cacheWarmthOf`), filled through a host port. Then:
- `send_task` `compact` in `CollaborationTools.ts`, accepted with the existing `end` barrier (`inboxItems.ts`) in one unit;
- the `compact_agent` answer from the entry the compaction writes;
- the prompt section in `CollaborationVoice.ts`.

Summarizer resolution is the one 478a03df built. Reuse it and never recompute it.

Done when acceptance 1–6 hold, shown by tests at the layers the rules allow; the claims of §8 are written or rewritten from the code and verified; and the change is committed.