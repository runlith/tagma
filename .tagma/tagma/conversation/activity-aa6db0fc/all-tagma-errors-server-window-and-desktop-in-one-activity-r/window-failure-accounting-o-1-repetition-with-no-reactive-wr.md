---
id: 01a179c9-bfb4-76ab-8a43-403ecf5eebd2
title: "Window failure accounting: O(1) repetition with no reactive write, sample with context and trail, batches into report_faults, Errors list from the server feed"
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a179c9-bfb4-76ab-8a43-403ac8860d90
  - kind: waits-on
    to: 01a179c9-bfb4-76ab-8a43-403c29f125c8
  - kind: waits-on
    to: 01a179c9-bfb4-76ab-8a43-403d8936b239
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/notices
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/FaultsButton.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/ServerFaults.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/Root.svelte
---
The service at the application's root takes part boundaries, `error` and `unhandledrejection`, `Failure.report`, and background refusals instead of `Notices.fault`, `thrown`, and `background`. A repetition is a `Map` increment, place context, and a burst counter; the stack — once between sends, the trail — at send time. The sender holds one batch in flight: a new group leaves within 2 s, a count growth — at most once a minute, an unaccepted batch returns into accounting, a retry carries the same ids, on leave — `keepalive`; accounting memory under a shared ceiling, new groups past it leave as a loss line. The Errors list merges the server's feed and the undelivered by fingerprint; Clear also removes its own window's undelivered; a line's look — by the tagma-design skill. Accounting, storm, wait-for-answer, and Clear tests come from the [[c8860d90]] acceptance.
