---
id: 01a14c08-8336-7b3c-965a-b0997b731471
title: "A plugin view acts on the operator's behalf: calls the plugin process, reads its data with updates, keeps state, and opens a thread on click"
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
    ref: apps/tagma/app/src/lib/features/plugins/pluginHost.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/views/ViewFrame.svelte
  - kind: file
    ref: apps/tagma/server/src/views/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/views/files.ts
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
  - kind: file
    ref: apps/tagma/server/src/views/storage.ts
---
**Value.** A plugin view is a live app, not a picture: the operator presses buttons in it, and the view calls the plugin process, reads its data with updates, remembers its own state, and leads the operator to the thread.

**How.** The view bridge over the MCP Apps protocol and `tagma/*` methods; below it the operator operations `call_plugin_tool`, `read_plugin_resource`, `read_view_storage`, `write_view_storage`, and a live subscription on the process resource.

**Behaviour.**
- A view calls only `view`-audience tools of its own plugin, enabled in the project; the process gets the caller as "the operator from this view and thread".
- Resource reads and subscriptions carry the project and view: one process for all projects decides itself whether to give a project's resource. A subscription outlives a process restart and fall.
- View storage is server-side key-value, shared by all of the plugin's views, projects, and devices, with a bounded value size.
- A view opens a thread, its own section, or a panel only on the operator's click inside the view; it sees what the thread does (see [[94567243]]); it speaks and listens through the server speech.
- The bridge takes plugin, thread, and key from the mount, not from the view's messages. A view is a plain page on the plugin's own origin, so it embeds others' widgets (a video player), while the origin difference holds the isolation.

**Limits.** A view does not act in Tagma beyond these methods. A browser that does not resolve `*.localhost` names (part of Safari) shows no views and says so. Cookies set by a view script through the remote door are seen by all plugins: there sites differ only by port.
