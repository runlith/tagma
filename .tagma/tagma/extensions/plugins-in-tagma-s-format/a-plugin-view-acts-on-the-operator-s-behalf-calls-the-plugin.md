---
id: 01a14c08-8336-7b3c-965a-b0997b731471
title: "A plugin view acts on the operator's behalf: calls the plugin's process, reads its data with updates, keeps state, and opens threads"
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7704-77d5-b31a-ec5a94567243
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b095d946528f
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09689f8466a
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09753f44cbc
sources:
  - kind: file
    ref: apps/tagma/server/src/views/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
  - kind: file
    ref: apps/tagma/server/src/views/storage.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/client.svelte.ts
---
**Value.** A plugin view is a live application, not a picture: the operator presses buttons in it, and the view calls the plugin's process, reads its data with updates, remembers its own state, and leads the operator to the thread.

**How.** `useTagma()` in the view's component, a client the window builds per mount; below it the operator operations `call_plugin_tool`, `read_plugin_resource`, `read_view_storage`, `write_view_storage`, and a live subscription on the process resource.

**Behaviour.**
- A view calls only `view`-audience tools of its own plugin, enabled in the project; the process gets the caller as "the operator from this view and thread".
- Resource reads and subscriptions carry the project and view: one process for all projects decides itself whether to give a project's resource. A subscription outlives a process restart and fall.
- View storage is server-side key-value, shared by all of the plugin's views, projects and devices, with a bounded value size.
- A view calls the MCP servers its plugin brought, under their sign-in, as its process does (see [[46bba31b]]).
- A view opens a thread, its own section or a pane; it sees what the thread does (see [[94567243]]); it speaks and listens through the server speech.
- The client takes plugin, view, thread and key from the mount, never from the view's own code.

**Limits.** A view's code runs in the window's own document with the window's authority. `useTagma()` is the surface it is written against and the one its calls are attributed to, not a wall: nothing stops its code from reaching the rest of the window. Installing a plugin with views asks no consent for this.
