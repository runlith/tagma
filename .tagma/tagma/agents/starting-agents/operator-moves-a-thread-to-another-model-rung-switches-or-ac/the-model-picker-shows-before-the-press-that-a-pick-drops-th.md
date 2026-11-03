---
id: 01a1a2ab-bcf3-706d-86eb-ffd72a42b641
title: The model picker shows, before the press, that a pick drops the warm cache and what the cold read costs
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1a29b-cc6e-7724-b4e9-780d6fc9fd65
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ModelPanel.svelte
  - kind: file
    ref: packages/agent/src/thread/cache/ThreadCacheWarmth.ts
---
**Want.** Before the press, the model picker tells the person what a pick does to the thread's prompt cache: a different model, account or reasoning rung that invalidates it makes the next request read the whole context cold. On a large warm context that is the most expensive moment of the thread, and today the picker says nothing: the loss shows only afterwards in the context ring as "model changed".

**Decided by the operator.** Information in the picker, designed into its rows; no confirmation step (the global rule against confirmation controls stands). A pick still lands on one press.

**What it must say.** Only when something is lost: a cache that is warm or likely warm and a candidate that would invalidate it. Then the size of the cold read and, where the provider prices tokens, its cost, or the quota it draws on a subscription. Nothing when the cache is already cold, the context is empty, or the candidate keeps the cache. When a compaction is running or queued, the switch lands after it, and the cold read is the compacted context — the words say so instead of quoting the full size.

**Owner.** Whether a pick invalidates the cache is the warmth owner's fact (`packages/agent/src/thread/cache/ThreadCacheWarmth.ts`, which already judges a reading against a selection); the picker reads that answer for a candidate and never re-derives it. Prices come from the catalog the compaction menu already prices with.

**Acceptance.** On a thread with a warm cache, the row under the cursor for a model that would invalidate it shows the cold read and its price or quota; the current model and a cache-keeping candidate show nothing extra; the words follow the tagma-design rules and fit the row without moving the layout.
