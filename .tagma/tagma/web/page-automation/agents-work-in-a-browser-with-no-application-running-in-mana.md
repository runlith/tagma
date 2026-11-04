---
id: 01a14c08-1c3f-7bde-a2e3-046de2a2ecf8
title: Agents work in a browser with no application running — in managed Chromium, which the server installs and launches itself
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/managed-browser
---
**Value.** An agent needs a browser even when the Tagma application is not running — on a headless server, at night, on someone else's machine.

**How.** The "Managed Chromium" host inside the server and the seeded "Agent (managed Chromium)" profile; a profile on this host is made with `create_profile` using the `managed` adapter. A profile build is Chrome for Testing, which the server downloads itself from the official addresses into its own data directory, or the installed Google Chrome with its own data directory.

**Behaviour.**
- Each profile is its own windowless Chromium process, which the server talks to over a pipe, with no listening port. The user agent carries no `HeadlessChrome`.
- By default agent pages go to the desktop profile; with no application running, `open_page` refuses with `host-away`, and the agent names the managed profile itself.
- The profile process exits 5 minutes after the last page; a page without an engine session unloads after 15 minutes.
- The managed host has no exact target-to-renderer CPU attribution. Silence therefore produces no automatic hang verdict or forced renderer crash: work waits for its own answer or session end and remains cancellable. A persistently busy renderer may survive target closure and be reused by a same-site target; recovery waits for the profile browser to end or uses another profile.
- A human sees such pages in the panel and on the phone by [[d78e542a|screencast]].

**Limits.** Sign-ins on desktop and managed-host profiles are separate and move by [[6355b04b|cookie import]]. There is no network-free way to get the Chrome for Testing build. There are no windowed managed profiles. A hung out-of-process child alone does not authorize crashing the main renderer.