---
id: 01a1488e-0090-7d2b-85cb-88a2088225c2
title: A managed-host page with no engine session unloads to dormant after 15 minutes
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/host.ts
---
The engine keeps a session on a page while an agent run drives it, a broadcast viewer watches, element picking is on, the page is shown, or under 30 seconds passed since the last action; otherwise it disconnects. So “long undriven and unshown” means “with no engine session” to the host: the host counts sessions on the tab and unloads the one whose last session ended 15 minutes ago — closing the target and reporting `dropped`. The page goes `dormant` and restores from the recorded address on the next show or action; back-forward history and unsaved form state are lost. The profile process exits 5 minutes after the last page.

15 minutes outlive a model step and a human glancing away from the phone, yet free the renderers (each a Chromium process) of agent pages whose runs ended, on a server that runs for weeks.
