---
id: 01a0ff2b-54ff-7f7f-91d2-8f57470336e6
title: Recap is shown as a card in the thread feed and in Peek
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0ff2b-54ff-7f7f-91d2-8f54dff5b0dc
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Conversation.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Peek.svelte
---
Returning to a thread, the first thing the operator sees in its feed is a summary of where it stopped, with an explicit recap mark. Before the thread opens, Peek shows the same summary.

## Feed

- Recap is a feed element right after the `basis.entryId` message [[dff5b0dc]]. The feed opens from the tail, so the fresh summary stands last before the input field.
- Recap and its status arrive with the thread state in the existing snapshot and state channel. The card is a projection of this metadata, not a model-history record.
- This is neither a model message nor an agent replica: the card carries a "↳ Recap" mark and its own background.
- Statuses:
  - current — an expanded card: `summary`, below it `next` and age;
  - `stale` — a collapsed row in its place, a click expands it;
  - `void` — not shown;
  - no recap — nothing shown.

## Peek

Peek (`Peek.svelte`) shows `summary`, `next`, and age under the title. On `stale` — a "messages since this recap" mark; on `void` — no summary.

List rows do not change: quiet rows stay quiet.

Labels are the app's English strings, like the whole Tagma interface. Claude builds it under the UI/UX rule.

## Acceptance

- After a pause the thread opens with the recap card last before the input field, and the same summary shows in Peek.
- A new replica collapses the card into a row in its place.
- A rewind touching the covered range removes the summary from the feed and Peek.
- A thread without recap and a thread with `threads.recap` off look as today.
