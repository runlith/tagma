---
id: 01a14c08-1c3f-7bde-a2e3-0476d576a8a6
title: "AdsPower-grade profiles: own proxy and fingerprint, windowed profiles, a CDP endpoint for external tools, per-thread contexts, and the user's Chrome"
ord: 8
tags: ["feature"]
fields:
  {
    "state": "promised"
  }
edges:
  - kind: relates
    to: 01a147b0-e165-75df-b2b0-9a12e9ce3844
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/contract/service/hosts.ts
---
**Value.** Working with many accounts and hard-antifraud sites: a profile with its own proxy and fingerprint, as in AdsPower or GoLogin, driven by both humans and agents.

**How (promised).** The built-in browser's second stage: profile proxy; Chromium-build adapters with fingerprint spoofing; managed profiles with a window; profile extensions; a profile editor with groups and bulk launch; moving profiles between machines; a page CDP endpoint for external tools and DevTools; ephemeral agent contexts per thread; a "User's Chrome" host.

**What stands.** Page records and host ports already carry a context field, but nobody fills it; a profile is bound to an adapter and its adapter document, so new builds land as adapters. Proxy, fingerprint, CDP endpoint, and per-thread contexts are not in the code.

**Limits.** Firefox engines are out of scope.
