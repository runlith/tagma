---
id: 01a1b1a5-85cc-793d-a9af-76bd9cb27285
title: A plugin's own threads stay out of the general thread list unless it lists them
ord: 11
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/listing.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/Threads.svelte
---
**Value.** A plugin that runs its own conversations — a tutor, a table of players — does not fill the person's thread list with them.

**How.** A thread whose bindings name a plugin under `plugin` is that plugin's. The plugin's `threads` point holds `{listed}`, false by default. The plugin's card lists its threads; `list_threads {plugin}` selects them by binding.

**Behaviour.**
- The general list, its counts, bulk archive by selection and the live list leave out the threads of a plugin that does not list them. With `listed: true` they stand in both places.
- `ids` selects exactly the threads named, whoever owns them, and `plugin` selects a plugin's threads whatever it lists.
- Turning the listing on or off, or enabling or removing the plugin, reaches open lists at once.

**Limits.** A plugin that is not enabled or no longer installed lists nothing, so its threads stay out of the general list and are reached by `plugin` or `ids`. A child an agent of such a thread spawns carries no plugin binding of its own and is not hidden by it. The plugin's own section or rail entry does not list them yet; its card does.
