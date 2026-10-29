---
id: 01a14c08-22b6-75de-88f8-5bf681b67923
title: "Quota counters in the status bar: the tightest window, the drain forecast, and the account switch for new threads and the current one"
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92913ae88b52
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/UsageMeters.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/Menu.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/usage/Popover.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/providers/usage/thresholds.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/quota.feed.svelte
---
**Value.** Subscription spend is visible out of the corner of the eye, and switching accounts when the window runs out happens without leaving the thread.

**How.** Provider segments in the status bar; on click — the "Usage" popover: in the header a "read now" button, below a detailed line of each provider with a submenu, at the bottom "Manage accounts…". The compact view is the status bar segments themselves, so the popup has no density switch.

**Behaviour.** A segment shows the percent of the fullest window. The color warns when the window is nearly exhausted or the spend rate will drain it before reset, and the hint names in how long the window will end and when it resets; a stale reading pales. The popup line names on the right the window reset the spend runs into ("7d resets in 3d"); a stale line pales and instead of the reset says when it was read. The provider submenu is the default account's windows, "Switch to" another default account ([[a65d1a0a]]), and for the thread on screen — "Use in this thread", pinning an account to the thread, and "Follow the default". A logged-out account or a rejected key leads to the Providers screen. In the feed the keep-warm ping names the account it is signed by.

**Limits.** Pinning an account changes the thread's model (A1, [[825673b8]]). A provider without quota gets no segment.
