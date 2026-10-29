---
id: 01a14bc0-7609-7d58-a98e-72588a9bdc58
title: Thread writes a short summary of where it stands after a run, and /recap writes one at once
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92977939353e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/recap.commands.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/recap.feed.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/RecapAttemptCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/RecapCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/thread/ThreadRecap.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/recap.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/prompt.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/refusals.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/schedule.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: recap
---
**Value.** Returning to a thread, the operator sees in seconds what it is about, where everything stands, and what is next, without rereading the conversation.

**How.** By itself after a run (the `threads.recap` setting, on by default); by hand — `/recap` or the `generate_thread_recap` operation.

**Behaviour.**
- The thread's own model writes the summary with one side request on the warm prompt cache; the thread's conversation does not change. It writes in the operator's language: what is decided and done, separately what is only proposed, and the next step or open question; the earlier summary enters the new one.
- An automatic summary waits for a pause after a run in which the operator wrote, and makes it before the cache cools; a new run cancels the wait.
- The summary card stands in the feed at the message it covers; Peek shows it only while no messages stand after it. Summaries of rewritten history (rollback, compaction) are not shown.

**Limits.** The summary makes no cold request over the whole history: without a held warm capture — after restart, unload, model change, or rewritten history — a manual summary refuses and advises to send a message and repeat after the answer. While a run is going, `/recap` is unavailable.

The same summary is shown by the [[15d6adf4|thread card in the list]], and every attempt lands in the [[98b2fb74|activity record]].
