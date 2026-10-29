---
id: 01a14c08-22b6-75de-88f8-5bf2a65d1a0a
title: A provider has several accounts; threads without their own account follow the default account
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92984519ff2b
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bf681b67923
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/accounts/Row.svelte
  - kind: file
    ref: apps/tagma/server/src/native-harness/models/defaultMoves.ts
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/choice.ts
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/defaults.ts
  - kind: file
    ref: apps/tagma/server/src/providers/credentials/operator.ts
---
**Value.** The operator with several subscriptions or keys of one vendor spreads threads across them and moves all new threads to another account in one click.

**How.** The account line radio button on the Providers screen, "Switch to" in the Usage popover ([[81b67923]]); the `set_default_account`, `rename_account`, `remove_account` operations.

**Behaviour.** A call is signed by the account pinned to the thread, otherwise the default account, otherwise the provider's only account; with several accounts and no default the request refuses and lists them. The first added account becomes the default. Deleting the default passes it to the next subscription account or the only remaining key; for CLI accounts it clears it. Accounts of a deleted adapter stay as a separate Providers section with only deletion: it also clears the default if it pointed at that account. Clearing the default explicitly is possible without an adapter; assigning requires one. A change of the default read before another's change refuses. In CLI-login mode Tagma's own path reads the CLI provider's default. A thread without its own account follows the default mid-work too: a Tagma agent on ACP moves to the new default at once if there is no run, or on the nearest step boundary if a run goes, without an interrupt line and with the same conversation. A run that fell on the previous account's limit continues on its own after the move. A thread with its own account keeps it until it is reseated ([[825673b8]]). A cleared default moves nobody. Renaming changes only the label by which the operator knows the account.

**Limits.** The default is one per machine, not per project. The agent does not change the default: operator-only operations.
