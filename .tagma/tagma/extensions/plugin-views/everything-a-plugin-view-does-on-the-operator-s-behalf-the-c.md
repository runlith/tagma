---
id: 01a12394-26b3-757f-9b65-586d178c84d6
title: Everything a plugin view does on the operator's behalf the client takes from the mount, never from the view's code
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/client.svelte.ts
---
`useTagma()` answers a client the window builds once per mount (`makeClient`), and every act it performs carries the plugin, view, thread and pinned key of that mount. The view's code never names them, so a view acts only as itself. A view's code runs in the window's own realm, so this is attribution of what the client does, not isolation. Isolation is kept only for someone else's HTML: a site in `<Frame>` and an MCP App window.

The server accepts a view's tool call (`call_plugin_tool`) only to a `view`-audience tool of a plugin enabled in the project, and hands the executing process the caller `operator {view, threadId}`. View storage (`read_view_storage`, `write_view_storage`) keeps the plugin's keys in `<plugin data>/view-storage/`, one file per key written through a rename, at most 1 MiB. It is shared across the plugin, not the project: the plugin tells projects apart itself, through `projectId`. A resource is read with `read_plugin_resource` and read again on each update of the live `views.resource.subscribe` feed, which the client holds only while something reads the value. A thread's state is the presence projection, watched the same way. A transcript is the `ThreadTranscripts` port's (explanation ccb6b2fb).

A tool call is checked inside the process generation that will execute it (`PluginHost.callAdmitted`); otherwise a call that waited through a restart would pass under the old manifest's audience. The `results` face checks the neighbouring `views` and `tools` of the same manifest, so a result naming an undeclared view, or a tool no agent calls, refuses the install with the reason. The process resource is read and subscribed through the supervisor, which opens an idle process. An open subscription keeps the process from going idle and ends with the process. While the feed is open the server resubscribes on the next generation, after a crash too, with a backoff of up to 30 s while the plugin itself is in backoff.
