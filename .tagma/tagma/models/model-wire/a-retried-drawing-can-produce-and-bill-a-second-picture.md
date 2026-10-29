---
id: 01a0c8cb-049a-70a4-a0b5-6a91ae1cf386
title: A retried drawing can produce and bill a second picture
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/llm/src/llm/drawing/door.ts
    symbol: draw
---
The one-shot transport calls the executor with no options, so the retry ladder is armed — where the quota read turns it off explicitly with `{retry: false}`. Every retry re-sends the whole request ([[c5a617d1]]) and no wire in this package carries an idempotency key, so a provider that produced an image before the failure produces another.

For a text turn a replay costs tokens; for a drawing it costs a picture. One partial mitigation exists and only on one surface: the subscription's `x-codex-image-turn-id` is minted once when the deployment is constructed, so every retry of a call carries the same value — whether that backend dedupes on it is vendor-side and unestablished here. The console and xAI surfaces send nothing comparable.

Decide whether the drawing path should pass `{retry: false}`, or whether the surfaces can carry an idempotency key. Claimed as [[6da0f518]].