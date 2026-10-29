---
id: 01a14c08-22b6-75de-88f8-5bf79e5e173a
title: The Providers screen names the prompt cache lifetime of a subscription — this machine's measurement or a shipped prior
ord: 10
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92913ae88b52
  - kind: relates
    to: 01a14bc0-761f-7208-a969-908ea267ca10
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/auth/cacheLifetimeWords.ts
  - kind: file
    ref: apps/tagma/server/src/providers/quota/cacheLifetimes.ts
  - kind: file
    ref: packages/llm/src/models/cacheLifetime.ts
---
**Value.** The operator knows how long a pause keeps a subscription's prompt cache warm — the cost of continuing a thread after a break depends on it.

**How.** The hint on the subscription section name on the Providers screen; the `read_cache_lifetimes` operation.

**Behaviour.** For each pause interval — the share of warm hits: this machine's measurement, once enough measurements have gathered, otherwise the prior the adapter measured and dated. The vendor-promised term stands beside it.

**Limits.** Only subscription providers; the quota and the warmth of a specific thread's cache are shown by other features ([[3ae88b52]], [[a267ca10]]).
