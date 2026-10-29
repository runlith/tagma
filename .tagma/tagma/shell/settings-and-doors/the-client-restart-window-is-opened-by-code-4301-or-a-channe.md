---
id: 01a127fc-6cf7-761a-b904-31e79d333245
title: The client restart window is opened by code 4301 or a channel break, survives reload in sessionStorage, and is closed by the feed's first frame
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Restart.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/live.ts
  - kind: file
    ref: apps/tagma/server/src/socket/connections.ts
---
A server leaving for restart closes live sockets with code `RESTARTING_CLOSE` (4301), declared in the live channel wire: this way the client learns about the restart before the channel breaks and does not mistake it for a lost connection. Both doors send the code — the local one (`Connections(false)` in composition) and the remote one (`remoteListener` with the `leaving` flag) — before the door closes, while `Succession.leaving` is true; without it the door closes with code 1001.

The client restart state is one `Restart` at the connection. It is opened by this page's restart act, code 4301, or any channel break; a break with no answer from another process's `/startup` is not a restart, and the window closes without a report. The window survives page reload in sessionStorage (start, client id, the "already reloaded" flag), so a reload after a client build change happens at most once and the window length reaches the restart record. The window is closed by the first feed frame of any thread open on the page after the channel break; the length is measured to that frame, not to the decision to close. With no open threads — and when the page stopped watching the last thread — the window closes `NO_THREAD_MS` after the channel returns, without a report; there is no deadline for waiting on the frame.

The window passes no verdict by time. "Stayed on the old one" holds only when the server that was asked to leave answers with the same process, and its restart on the `/startup` answer is not running or recorded a failure; the failure cause reaches the status row. While the server is silent, the strip under the top panel shows how long that lasts and the step of the announced update, with no warning; the phase's internal name does not reach the screen: the page does not see whether the process is alive; the desktop window sees it and decides on its own ([[d6920c21]]). There is no per-attempt request deadline — rolled back on the operator's word.
