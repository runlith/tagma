---
id: 01a1b1a5-85cc-793d-a9af-76bd9cb27285
title: A plugin's own threads stay out of the general thread list while it runs without listing them
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
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/ThreadsPage.svelte
---
**Value.** A plugin that runs its own conversations — a tutor, a table of players — does not fill the person's thread list with them, and a person who removes the plugin keeps them.

**How.** A thread whose bindings name a plugin under `plugin` is that plugin's. The plugin's `threads` point holds `{listed}`, false by default. The plugin's card lists its threads; `list_threads {plugin}` selects them by binding.

**Behaviour.**
- While the plugin is enabled in a thread's project and does not list, the general list, its counts, bulk archive by selection, the window and the live list leave out its threads, including a bound child under a visible parent; the window and live list also leave out whatever stands below a hidden thread. With `listed: true` they stand in both places.
- A plugin switched off in that project, removed or never installed leaves its threads ordinary: they are listed like any other thread.
- `ids` selects exactly the threads named, whoever owns them, and `plugin` selects a plugin's threads whatever it lists.
- Turning the listing on or off, or enabling, disabling or removing the plugin, reaches open lists at once.
- The card lists the plugin's threads whenever the plugin's row exists, enabled or not, a page at a time with a "Show more" control; it never reads all histories.

**Limits.** A child an agent of such a thread spawns carries no plugin binding of its own and is not hidden by it. The plugin's own section or rail entry does not list them yet; its card does.
