---
id: 01a13d57-c92a-783c-bbf3-4ad2adffc3bf
title: "Project pulse: a threads.pulse feed at the thread-list owner and an app-tier ProjectPulse"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d58-a2a3-7367-b56b-d22b00c4e477",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d1d-cf8d-7804-a695-42f728361cbb
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Pulse.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/pulseFeed.ts
---
Implement [[28361cbb]]: the `threads.pulse` feed (declared next to `ATTENTION_FEED` in `server/src/threads/contract/wire/feeds.ts`, wired in `server/src/threads/list/feeds.ts`, projected in `list/pulseFeed.ts` over the shared `ThreadList.subscribeAttention` source), `awaiting` by `attentionOf`, `working` by `life`, a new `all` on `resync`; app-tier `ProjectPulse` in `apps/tagma/app/src/lib/features/projects/Pulse.svelte.ts` with `of(projectId): { working, awaiting }` (zeros for an unknown project). The strip [[4e40cd91]], built in parallel, reads that signature. The delivery is checked by 22 unit tests of four feeds and an independent review. The end-to-end `pulse.itest.ts` stays unconfirmed: both runs stopped at boot over a missing `TouchMarks` export in the parallel Effect migration. The server typecheck reported 304 errors outside the delivery files; the app typecheck ended `SIGKILL`. After the migration lands, repeat the integration test and both typechecks.
