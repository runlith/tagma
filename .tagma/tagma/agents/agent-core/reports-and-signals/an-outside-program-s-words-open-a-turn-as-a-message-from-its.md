---
id: 01a1b19c-e374-7a35-96ea-ae684020c5c8
title: An outside program's words open a turn as a message from its name, never as the person's words
ord: 22
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a146cf-9c17-7818-810d-9a864bd3b0cd
sources:
  - kind: symbol
    ref: packages/agent/src/thread/inboxItems.ts
    symbol: spokenByOther
  - kind: symbol
    ref: packages/agent/src/thread/inboxItems.ts
    symbol: isReaderWordsItem
  - kind: symbol
    ref: apps/tagma/server/src/threads/turns/caller.ts
    symbol: speakingCallerOf
---
A turn admitted from an outside caller (`AdmitCaller` `external`) is a `turn` item whose sender is `{kind: 'external', name, title?}`. It still opens a run, but `isReaderWordsItem` is false for it and `spokenByOther` true. So it never joins the person's opening words, never marks reader input (skill requests, reader position, withdrawal into the composer on a stop), and opens its run as a `message` signal with `from` set to the title, or to the name without one, the way another thread's task does, its attachments resolved into the model's message as any signal's are. The agent reads it as `<message from="…">`, and its transcript entry carries that title, which the feed draws as the sender. Words it sends into a run that is going become the same message signal rather than a reader steer.

`name` stays the caller's address: idempotency keys and evidence are built from it, so a renamed plugin replays the same act. `title` is display only. The server writes it from `plugin-host`'s slot titles when the caller is a plugin (`speakingCallerOf`). The kit knows an outside sender, never a plugin.