---
id: 01a132a1-eba2-7d5d-bfd7-ce1a640fd6e6
title: "A thread's approval mode always switches: the choice is queued, never dropped over someone else's in-flight work"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13294-de10-7e27-b6a9-9e295b0e505d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12cb2-2d1a-748b-8670-c65c166cd559
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/thread/ThreadAuthority.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThreadWrites.ts
---
The operator could not switch trust/review/bypass: a click on the mode in the composer, on the terminal-thread button, and in the mobile options silently did nothing.

**Cause.** `ThreadWrites.chooseMode` returned without writing while `canChooseMode` was false, and it combined prohibitions from other people's work: an in-flight send (`commands.pending` stands until the server accepts the message — e.g. the whole time a run waits for an answer to a question), a command answer/continue/compact, model recording, recap, delegation recording. On top of that, `ThreadAuthority.chooseMode` dropped the click while the previous mode write was still in flight. The server (`set_thread_authority`) accepts the mode in any thread state.

**Done.** The mode choice depends only on whether the thread declares modes:
- `ThreadAuthority` queues every choice: writes go one at a time, the last accumulated one wins, the chosen mode is visible at once (`modes` with `intended`), a refusal returns the server's mode and names the cause.
- The mode cycle (`ThreadWrites.cycleMode`) counts the next from the already chosen one, so two fast clicks advance the mode two steps.
- The composer, the terminal-thread button, and the mobile screens read the mode from `ThreadWrites.modes`; they no longer have `disabled`.
- The mode write no longer holds delegation or compaction (`ThreadAuthority.busy` is delegation only); the model choice is no longer dropped either because of an in-flight send or a mode write.

**Check.** `ThreadAuthority.svelte.test.ts` test: a mode chosen during an in-flight send and an unanswered previous mode write arrives, both clicks in order. Authority and slot tests pass (31).
