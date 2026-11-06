---
id: 01a1b2cd-b5b6-7deb-9d6d-414bcbd62447
title: A plugin places the person's own thread in its view, adds parts and commands to every thread's composer, and checks Tagma's agent before it acts
ord: 12
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b0997b731471
  - kind: relates
    to: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/pluginParts.composer.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/seats/ThreadSeat.svelte
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/hooks.ts
---
**Value.** A plugin works inside the conversation instead of beside it: a merge-request board shows the thread it is about and the person answers there; a tutor puts a "say it in German" button and a `/translate` command into every composer; a guard refuses a risky call before Tagma's agent makes it.

**How.** `<Thread id>` from `@runlith/tagma/ui`; the `composer` and `commands` fields of the definition, with actions behind commands; `hook()` handlers at the agent's points.

**Behaviour.**
- `<Thread>` is the whole thread — feed, composer, model picker — and acts as the person; other threads it opens go beside.
- A composer part receives the thread, the draft (`setText`, `insert` at the caret, `attach`) and `send`; a part that fails shows its failure alone.
- A text command fills the draft; an action command asks for words and fills the draft with the action's answer.
- A hook is asked only for matching calls, wakes the plugin's process, waits 10 s by default, and lets the agent go on when it fails unless it blocks on failure.

**Limits.** Parts and commands show only in projects where the plugin runs. Hooks reach Tagma's own agent, never Claude Code's or Codex's own tools. A plugin adds no entries of its own to the feed. The seat takes no keyboard focus and none of the window's thread shortcuts by itself.