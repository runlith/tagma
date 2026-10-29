---
id: 01a0c98e-c2c4-7ad4-8a93-13ab4825aed7
title: The slow_down flag now leaves the sign-in owner, and four boundaries between it and the pollers still drop it
ord: 20
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c8cb-0496-70bf-8c94-ce71c482c387
---
Found while fixing [[c482c387]] (`43e3143864`), which carried the vendor's `slow_down` out of `ProviderSignIn.complete` on `ProviderSignInPendingError` so the producer no longer drops it. The reviewer confirmed the producer half is correct at its owner and that no consumer honours the flag — the fix is incomplete as an answer to "nothing downstream could obey it" until these do.

Road to the cadence driver, measured:
- tagma: `apps/tagma/server/src/http/handlers/auth.ts:192-194` reduces the error to `{pending:true, message}`, so the flag never crosses the HTTP boundary.
- the poller sits on a fixed interval: Tagma's `ProviderGroup.svelte:115`.
- The +5s behaviour the product already states lives on a different road (`deviceGrantApproval` in `flows/deviceGrant.ts`) that `ProviderSignIn.complete` never takes.

Fix at each consumer: carry the flag across the HTTP boundary the way the error already carries `pending`, and let the poller raise its own interval — which is what the package's own +5s rule obliges. Do not make the producer bump anything itself: nothing reads the interval it would bump.