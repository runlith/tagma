---
id: 01a13c29-a9c0-7991-8f82-2cd509f9a92a
title: "A removed provider's accounts and default account cannot be seen and removed: the Providers screen hides them, and set_default_account and rename refuse provider-not-installed"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151a6-a000-7317-96d9-46ee9945ab67",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c18-e04c-7b71-bc15-c609ef3b19d0
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/usage/Accounts.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/providers/accounts/defaults.ts
---
Found by the review lens [[01a13c1d-5098-7bf6-b5cc-cc5f7424a0a1|lens-gone-provider-paths]] while fixing [[ef3b19d0]]. They do not block the work, but they cannot be removed from the app.

- At the time of the fix, `AuthPanel.svelte` already showed a separate `not-installed` row section; the shared `accounts/Row.svelte` left unavailable default, rename and refresh in it. `usage/Accounts.svelte.ts` serves the Usage popover and needs no such fix.
- `set_default_account` (through `operations.ts` → `registry.registration`) and `DefaultAccounts.known` refuse `provider-not-installed` even for clearing; `remove_account` removes the token but leaves the `default_account` row.
- `rename_account`, `begin_sign_in`, `read_provider_token` for a removed provider refuse with a single "install the adapter" unblock.

Do: a removed provider with standing accounts is visible on the Providers screen as a separate section with one action — remove the account (with its default account); no other actions are offered for it. The spec [[52b10a62]] requires that ids survive adapter removal — removal by the user's will stays.

Proof: four `composition/testing/http/accountsDoor.itest.ts` tests check credential and linked-default removal, keeping another's default, clearing without an adapter, assignment refusal and stale revision; a removed harness's directory account is visible and removed together with its default, but its CLI directory stays. The independent review's remark on directory accounts is confirmed and fixed in the saved-provider enumeration and the removal owner choice. Ten more checks cover live CLI accounts and launch account choice. `providers/Orphans.svelte.test.ts` mounts the real Providers screen with an empty catalog and checks the visible account, the single remove action, and the section disappearing after it. Narrow `bun check` over the changed server files passed; the full app svelte-check did not finish inside the 10-minute project limit, and the live UI was not checked.
