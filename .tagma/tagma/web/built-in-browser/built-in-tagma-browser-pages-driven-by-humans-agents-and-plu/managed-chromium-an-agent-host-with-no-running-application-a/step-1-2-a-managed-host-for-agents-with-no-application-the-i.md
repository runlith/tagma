---
id: 01a147d6-7ef4-7c9c-9e39-feae8df087e4
title: "Step 1.2: a managed host for agents with no application, the installed-chrome build, and screencast to the panel, the web, and the phone"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a147b0-e165-75df-b2b0-9a10eb1e2301
  - kind: waits-on
    to: 01a147d6-7ef4-7c9c-9e39-feaa461a081e
---
Bring [[eb1e2301|managed Chromium]] to an agent host: unloading and idle shutdown, a windowless identity with no `HeadlessChrome`, the `installed-chrome` build; screencast with a producer budget, ACK, eviction, a static-page snapshot, page size from the native view, ordered viewer input, clipboard, files, and downloads; the `PageView` screencast adapter and the page screen on the phone.

Done when: the spec's performer checks pass, the server event-loop measurement is recorded as one sample; `bun run typecheck` is clean; review is done; the commit goes through `submit_work`.
