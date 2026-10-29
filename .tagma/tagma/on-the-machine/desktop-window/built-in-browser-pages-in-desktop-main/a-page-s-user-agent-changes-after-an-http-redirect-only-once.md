---
id: 01a16428-bbf8-7383-ad6e-4146c6ee4e5b
title: A page's User-Agent changes after an HTTP redirect only once loading completes
ord: 5
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/desktop/src/browser/page.ts
    symbol: HeldPage.follow
  - kind: symbol
    ref: apps/tagma/desktop/src/browser/profiles.ts
    symbol: Profiles.prepare
---
Chromium allows a UA change at the start of navigation, but setUserAgent during redirect can trigger Reload and destroy the NavigationRequest inside a callback where deletion is forbidden: a native crash of all of Electron. So request headers are chosen in the profile, and the final origin's JS identity syncs after loading completes. A permanent debugger for UA would change the behaviour of ordinary user pages; CDP spoofing resets after detach. The browser-side override changes before the renderer accepts the settings: the did-stop-loading event itself does not yet confirm the updated navigator.userAgent.
