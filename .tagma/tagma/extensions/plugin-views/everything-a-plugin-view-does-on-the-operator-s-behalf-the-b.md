---
id: 01a12394-26b3-757f-9b65-586d178c84d6
title: Everything a plugin view does on the operator's behalf the bridge takes from the mounting, not from view messages
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/pluginHost.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
---
A view lives on its plugin's own origin ([[a9714f0d]]), but the bridge knows the plugin, view, thread and pinned key from the mounting, not from the view's messages. The server accepts a view's `tools/call` only to `view`-audience tools of a plugin enabled in the project, and hands the executing process a caller `operator {view, threadId}`; `tagma/storage` holds the plugin's keys in `<plugin data>/view-storage/`, one file per key (written via rename, up to 1 MiB). Storage is shared across the plugin, not the project: the plugin tells projects apart itself via `projectId` from `hostContext.tagma`. `tagma/open` opens a thread only on a click inside the view. `tagma/thread` is the thread's presence projection (run life, tail text or last line), with updates arriving as `tagma/notifications/thread` while the mounting lives, or until the view removes the observation with `tagma/thread/unwatch` (which also frees the presence subscription); threads of other harnesses have no line text — the text is only the tail of an ongoing answer.

A tool call is checked inside the process generation that will execute it (`PluginHost.callAdmitted`): otherwise a call that waited through a restart would pass under the old manifest's audience. The `results` point checks the neighbouring `views` and `tools` of the same manifest (`PluginContribution.sibling`): the error shows as the plugin's failed process at start, not as an install refusal, because point registration runs after the schema check. The process resource is read and subscribed through the live supervisor generation; the subscription ends with the process, and the server resubscribes on the next generation while the feed is open — including after a crash, with backoff up to 30 s while the plugin is in backoff.
