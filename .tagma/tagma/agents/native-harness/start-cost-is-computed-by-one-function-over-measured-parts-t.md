---
id: 01a147eb-d22e-74ef-add5-0c510aa24a9f
title: Start cost is computed by one function over measured parts; the card is written on the first model request of the operator thread first run
ord: 20
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a147a2-8160-7c3f-82a0-b2721ce2ba9f
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/start.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/startCard.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadBranch.ts
---
One function, `startCost`, computes the breakdown over measured parts; the parts' measures are also the same everywhere: tool size — `toolChars` of the agent package (name, description, and schema as the wire sees them), law and dictionary — the sum of `InstructionSet` record texts by kind, notes — the lengths of the texts `nativeTurnContext` puts into the context message `parts`. So the thread card and `start` in `read_agent` agree on every part both sides collect; they differ only in parts only the thread knows (atBirth tools and their deferred list, the workspace note). A part the reading did not find stays `null`: it is excluded from the sum, and the card shows it as unread, not as zero.

The card is written by the kernel request-landing subscriber (the harness's `requests()`, `RunRequests.landed`) on the request with `stepNumber` 0 — the same on native and `acp`: then the thread holds the run's `composition` record, the context message with notes, and the delivered law set. The first run is marked by `composition` itself (`opening`): it is built by a run whose history has no model answer yet. Actual input tokens are that request's usage; a request without usage yields a card with `inputTokens: null`. The turn's words (the `Admitted` prompt on `acp`) give no card: only a model answer does. A thread whose first model call failed gets no card until request 0 lands. The card goes to a root whose `createdBy` in the thread record names the operator. Root birth records the creator from the call's actor; workflow names itself, and schedule enters as the plugin's external caller. A root with a copied history keeps the new thread's creator, not the source's: a root born by `spawn_agent` with `link: root` names the calling thread, the operator branch names the operator. A child thread gets no card; an empty `createdBy` does not prove the operator opened the thread. The card has a stable id `start-cost:<thread>`; rewriting replaces it.

The `agent.startShare` threshold (project and user) is a share of the thread model's window, 0.1 by default, compared in characters: share × window × characters per token. Characters per token is `4 / weight` of the compaction calibration for the provider/model pair — a measured ratio, not a constant. 10% is chosen from the range of windows Tagma serves — from 128k on small and local models to 1M: the share keeps the threshold proportional to the room the thread has left to work, and does not depend on the machine, because the start price is tokens, not cores or disk. One sample: the runlith root thread's first request — about 82k tokens, 8% of a 1M window (no card) and 41% of a 200k window (with card).
