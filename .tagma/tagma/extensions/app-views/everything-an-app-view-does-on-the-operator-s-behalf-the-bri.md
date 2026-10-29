---
id: 01a12394-26b3-757f-9b65-586d178c84d6
title: Everything an app view does on the operator's behalf the bridge takes from the mounting, not from view messages
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/pluginHost.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/views/shelf.ts
---
Everything an app view does on the operator's behalf, the bridge takes from the mounting, not from the view's messages. A view lives on its app's own origin ([[a9714f0d]]), but the bridge knows the app, view, thread, and pinned key from the mounting, not from view messages. The server accepts a view's `tools/call` only to `view`-audience tools of the app enabled in the project, and hands the executing process a caller `operator {view, threadId}`; `tagma/storage` holds the app's keys in `<app data>/view-storage/`, one file per key (written via rename, up to 1 MiB). Shared across the app, not the project: the app tells projects apart itself via `projectId` from `hostContext.tagma`. `tagma/open` opens a thread only on a click inside the view. `tagma/thread` is the thread's presence projection (run life, tail text or last line), with updates arriving as `tagma/notifications/thread` while the mounting lives, or until the view removes the `tagma/thread/unwatch` observation (which also frees the presence subscription); threads of foreign harnesses have no line text — the text is only the tail of an ongoing answer.

A tool call is checked inside the process generation that will execute it (`TagmaApps.callAdmitted`): otherwise a call that waited through a restart would pass under the old manifest's audience. The `results` point checks the neighboring `views` and `tools` of the same manifest (`TagmaAppContribution.sibling`): the error shows as the app's `failed` row at startup, not as an installation refusal, because point registration runs after schema checks. The process resource is read and subscribed through the live supervisor generation; the subscription ends with the process, and the server resubscribes on the next generation while the feed is open — including after a crash, with backoff up to 30 s while the app is in backoff.
