---
id: 01a14c08-22b6-75de-88f8-5bfc99c7336a
title: An author writes their own provider adapter on the @runlith/tagma/adapter contract and checks it with contract tests before installing
ord: 15
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
sources:
  - kind: dir
    ref: packages/tagma
---
**Value.** A provider Tagma does not know can be added by anyone without touching the core, and checked before installing that Tagma will accept it.

**How.** The `@runlith/tagma` package's `/adapter/*` doors: `defineAdapter` and the contract types, the new-adapter template (`bun create @runlith/tagma-adapter`), contract tests, and the author distribution build.

**Behaviour.** The contract is one for built-ins and externals: every built-in adapter is written on it. The provider is declared as a wire — the call goes by Tagma's native agent over HTTP: models, request profile, login, quota — or as a harness — the call goes by the vendor's CLI: models, CLI login, account environment. It may declare login paths, borrowing another provider's accounts, the section login mode, and a settings schema with instances; the adapter brings no interface, the screen is drawn by Tagma. Contract tests take the declaration apart by the registry court, run a login and a model call against a stub, and require `LLMError` errors; the template passes them.

**Limits.** The package is marked `private` and is not published to npm, so an author outside the monorepo will not receive it; publication is promised by spec [[52b10a62]] to the first external author.
