---
id: 01a14c08-22b6-75de-88f8-5bfbf3189649
title: "A broken or deleted adapter does not bring Tagma down: the provider stands with a reason, and its accounts and threads wait for its return"
ord: 14
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92984519ff2b
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/adapters/Row.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/AuthPanel.svelte
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/judge.ts
  - kind: file
    ref: apps/tagma/server/src/providers/contract/service/registry.ts
---
**Value.** A bug in one adapter does not deprive the operator of the other providers, and moving to a build without an adapter does not lose logins and threads.

**How.** The adapter's "Failed" line with a reason in the Adapters section; the "provider not installed" section on the Providers screen.

**Behaviour.** An adapter that threw on loading or declared an incorrect provider stands as failed with a reason; calling its provider refuses with an offer to fix or update the adapter. Built-ins load the same way and also do not bring down startup. A provider whose adapter is deleted or switched off refuses with "provider not installed", and its threads, default account, credentials, and latest quota readings are kept and work again when the adapter returns. Such a provider's own credentials and directory accounts stand on the Providers screen as a separate section with only deletion; it also clears the default if it points at the deleted account. A directory account deletes as a Tagma record, without the CLI directory and login.

**Limits.** Without an adapter no default account can be assigned, renamed, or quota-refreshed. Clearing a kept default needs no adapter.
