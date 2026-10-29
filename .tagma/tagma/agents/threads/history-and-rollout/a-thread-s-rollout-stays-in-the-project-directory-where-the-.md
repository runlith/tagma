---
id: 01a17f4f-3931-70e2-8aa2-8195c2f2ce50
title: "A thread's rollout stays in the project directory where the thread was born: the journal place is thread_journal_place, not the home"
ord: 13
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17f1c-bd6b-776b-a00f-dc252a0c2131
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/replay.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutContext.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/journal.ts
---
The rollout file lies in the project directory where the thread was born, and a home move does not shift it: the journal directory is a journal fact, remembered by `thread_journal_place`, while `journalProjectOf` takes the home only when no row exists. The move does no file operations, so there is no window where a failure would split the file and the home row, and an offloaded thread whose journal is only the file moves the same as a live one. Hence the rule for every journal reader and writer: the path goes through `RolloutContext.journalOf`/`locate` or `journalProjectOf`, never through `pathOf` with the home from `ThreadRecords` — otherwise after the move the write would go to a second file in the new home's directory, and reading an offloaded thread would miss its history.

Meta in the journal names the new home; on the step boundary its record is queued into the journal (`queueMeta`), because the boundary commit runs under the thread journal's hold and a direct write would fall with `ReentrantCall`. Recovery from rollout files derives the journal place from the file's directory and writes `thread_journal_place` when it diverges from meta's home.
