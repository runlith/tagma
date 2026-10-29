---
id: 01a14c08-8336-7b3c-965a-b09c2e400c78
title: An app launches threads, learns how each of their turns ended, and archives them
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
  - kind: relates
    to: 01a14bc0-76bc-7bce-a3ea-c23dafb820dc
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/pluginEndings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/pluginEndings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/acts.ts
---
**Value.** An app runs its own agents itself — a game deals a turn to a player, a bot handles a request — by launching threads and learning how each of their turns ended, with no polling.

**How.** The app process births a thread with a `bindings.app` tie to itself and sends turns into it with thread operations open to an outside caller. The `on` point names the `ended` tool, which Tagma calls at the end of each turn of such a thread.

**Behaviour.**
- A turn's end arrives with the thread, run, status, and failure reason; the tool answer confirms delivery, an error or silence is a retry, so the app takes the end idempotently by run.
- An end falling on a process restart or fall waits for the next process and repeats a bounded number of times; an app switched off, uninstalled, or without `on.ended` does not get the end.
- Only turns are delivered — no keep-warm and no compaction.
- The app archives and restores the thread tied to it, with its subtree.

**Limits.** The agents an app declares as files, their approval mode, and the library are described in [[cad90fdf]]; operator notifications in [[afb820dc]].
