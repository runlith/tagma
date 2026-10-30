---
id: 01a18d5f-1e10-7fda-99bc-25fc9ee84806
title: Harness contract public, ids from the registry, hook process decided by measurement, registry lifetime — no vendor moved
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cbf-97fc-7f17-bc60-685157787448
---
Steps 1–3 of the Migration in spec [[57787448]]. No vendor moves in this task.

- **Public contract.** The `terminal` and `acp` surface types move into `@runlith/tagma/adapter`, together with the lowest wire types they reference, and so do the hook codec and metadata reader contracts.
- **Ids from the registry.**
  - `HarnessName` becomes an id validated against the registry at the acts that need an implementation.
  - `harnessAdapter()` becomes a registry lookup, fed for now by the existing static rows.
  - The app moves from `HARNESS_LABELS` to the served presentation.
  - `threads.harnessTransport` and `threads.harnessProfile` become records validated against the registry. The dead `cursor` transport key goes.
- **Hook process.** Both designs from the spec are measured with `hookIngress.bench`, and the one that keeps its budget lands. `--harness` accepts any installed id.
- **Registry lifetime.**
  - `HarnessRegistry` gains withdraw and replace.
  - Contributions follow the registry's changes.
  - A removed harness keeps its chats readable. New acts on it refuse `harness-not-installed`.
  - A live process holds its package version.
- **Births** refuse a harness whose program is not installed, with `harness-not-installed` and the install hint, before anything launches.
- **One title condition.** `threads.harnessTitle && threads.autoTitle` decides both launching the CLI's title call and taking its title.
- **The `harness` agent's description** is composed from the declarations.
