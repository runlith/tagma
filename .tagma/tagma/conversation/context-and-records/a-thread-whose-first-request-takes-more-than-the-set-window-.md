---
id: 01a14bc0-7656-71a8-87f1-676f905b4121
title: A thread whose first request takes more than the set window share shows what its start consists of in the feed
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/start.kinds.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/StartCard.svelte
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/start.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/startCard.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/settings.ts
    symbol: startShare
---
**Value.** The operator learns that a thread started work with a heavy context and sees which part of the start — tools, law, dictionary, map — weighed it down.

**How.** A card in the feed; the threshold is the `agent.startShare` setting, a share of the model window.

**Behaviour.** After the first step of a root thread opened by the operator, the server compares the start size against the window share. When the start is heavier, the card shows the size, the window share, and the breakdown by part; when the provider returned usage — the actual input tokens too. A part that could not be read is marked as such.

**Limits.** Children and threads born by workflow, schedule, or agent get no card. A thread has one card.

The same cost before birth is shown by the agent preview in the [[cad90fdf|agent library]], and the composition of every next request by the [[a267ca10|context ring]].
