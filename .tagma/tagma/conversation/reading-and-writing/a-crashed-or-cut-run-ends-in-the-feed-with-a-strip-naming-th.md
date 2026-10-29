---
id: 01a14bc0-7602-7cab-b241-acda4f784251
title: "A crashed or cut run ends in the feed with a strip naming the cause and the next step: Continue, rolling back crashed turns, or another model"
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92846c655f6f
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/RunEnding.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/runEndingLine.ts
  - kind: file
    ref: packages/chat-ui/src/RunEndingStrip.svelte
---
**Value.** At a glance the operator understands why a run did not finish the work — provider limit, quota, key refusal, cut — and continues with one button.

**How.** A strip above the composer after a crashed or cut run.

**Behaviour.**
- The failure names the provider and the kind of cause; with an exhausted window limit — when it resets.
- A retryable failure and a cut offer Continue and name the model the thread will continue on.
- A non-retryable failure with crashed turns behind it offers to roll those turns back to the last good message, switch models, or still continue.
- A cut shows the words of whoever made it, when there are any.

**Limits.** There is no Continue for a thread whose transport cannot continue. The same strip shows a compaction refusal — that is the compaction feature (A1).
