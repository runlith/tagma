---
id: 01a12c46-ab9c-7595-ace5-ac39b8a4772b
title: "Provider registry instead of enumerations: adapter contract, failed, provider-not-installed, catalog by feed"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c47-00db-7c9c-bac5-59ed12329bd1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
---
Sections "Adapter contract" and "Registry" of the spec ([[52b10a62]]). One registry in `providers` replaces the enumerations in `packages/llm` (`models/vendors.ts`, `models/catalog.ts` `SHIPPED`/`OAuthProviderId`, `profiles/index.ts` `VENDORS`, `oauth/shipped.ts`), on the server (`providers/contract/wire/catalog.ts`, `Schema.Literals` in wire, `REFRESHERS`, `isLoopback`, `cli/signIn.ts`, `DEFAULT_MODEL`) and in the client (catalog and icons by feed). Built-ins connect through a lazy import from composition; a load failure is `failed` with a reason; a removed provider is `provider-not-installed`; the menu holds declared models, frozen for the run. Remove `egressOrigins`, `drawing` and image tails; `spawnGuidance` moves to an operator setting at `settings`. Done: the spec checks for no vendor ids in the core, `failed` and `provider-not-installed` pass, everything that works at the operator's works.

Made in commits cd4cc50412, d225c74bf6, eaadfa68be, 870dcf70f6, 7d08a12c25, 9e0ba7f574, 633a999f34, 2ced15e369 with review fixes in ef282b3cb3. Not proven: external (non-built-in) adapters do not connect — no delivery; vendor code is still in `packages/llm` until 51d6a7bf; `ModelAccess` (`capacity`, `cacheLifetime` …) throws a plain error if the thread's provider was removed after birth; `harnessStored` returns `provider-not-installed` as `TokenStoreFailed`; removed-provider accounts are not visible in the UI; adapter icons are inserted via `{@html}` without sanitization (trusted adapter code); no live check by the operator in the app was run.
