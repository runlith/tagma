---
id: 01a14bae-6720-7d62-897a-92984519ff2b
title: Each thread runs on its own model and account; a new one is born on the operator's defaults
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9276efa7d836
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92819bf508ea
  - kind: supersedes
    to: 01a14b6d-b201-7441-9c04-0ef8664eb914
  - kind: supersedes
    to: 01a14b6d-b295-7f51-a786-c2330648256d
  - kind: supersedes
    to: 01a14bae-6720-7d62-897a-928201f04977
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/birth/BirthSettings.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Favorites.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ModelDefaults.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ModelPanel.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/harness/registry.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/models.ts
    symbol: MODEL_OPERATIONS
---
**Value.** The operator spreads threads across several subscriptions and keys instead of setting up the model again for every new thread.

**How.** The model picker in the new-thread draft remembers the choice as the default; operations `read_model_defaults` and `set_model_defaults`, `read_model_favorites` and `set_model_favorites`; the account at thread birth and in `set_thread_model`.

**Behaviour.** A thread born without a named model is born on the default model, rung, switches, and account; switches are remembered separately per model. Until the default is saved, it is the default model of the first provider in product order — subscriptions before keys, Claude before ChatGPT — on which the Tagma agent runs and which has a login or a key; once offered, that model stays the draft's through a sign-out until the first send saves it. A thread born without a named account keeps its own while the provider stores it, and the picker identifies the account assigned to the thread. While the server is still looking for a CLI login, the draft's model slot says it is looking and no connect card shows; "Connect another way" beside it opens the card without ending the search. A sign-out never switches anything: a draft whose account is signed out keeps its model and account, names the account with "Sign in again" and "Choose another account", and a send stops before any thread is born. Favorite models stand first in the picker, in the operator's order.

**Limits.** A saved model whose adapter is not installed yields to the first available one and returns with the adapter. With no provider connected at all, no thread is born, and the draft offers to sign in with a subscription already on the machine or to add a key. Provider connections, logins, quotas, and the provider default account are the models-and-providers area (A7).
