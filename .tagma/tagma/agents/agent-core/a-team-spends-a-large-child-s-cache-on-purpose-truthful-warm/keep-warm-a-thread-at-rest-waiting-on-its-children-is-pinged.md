---
id: 01a0da9c-e1ea-7899-9fea-eeffc612609c
title: "Keep-warm: a thread at rest waiting on its children is pinged before its cache expires, up to the operator's count per wait, with no history written"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0da9d-2835-72b5-8756-1d25d8474c23",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0da9c-b613-74a3-844d-566d021c93b2
---
Implements §4.4 of [[021c93b2]], with acceptance 7–9.

- **Settings.** `agent.keepWarm` (default on) and `agent.keepWarmPings` (default 3), declared in `apps/tagma/server/src/protocol/settings.ts`.
- **Driver.** A server driver wired in the same change (rule a00f91b0), deriving its schedule at boot and on thread frames.
- **Kernel request.** A prefix-only ping request that records a `keep-warm` feed entry and refreshes the context reading without writing history.
- **Stop.** The stop conditions of §4.4, using spendability from `apps/tagma/server/src/ai/spendable.ts`.

Done when acceptance 7–9 hold, shown by tests at the layers the rules allow; the claims of §8 for keep-warm are written from the code and verified; and the change is committed.