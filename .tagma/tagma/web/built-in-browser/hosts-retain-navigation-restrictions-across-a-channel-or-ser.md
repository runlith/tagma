---
id: 01a18510-7006-7471-a84b-9a96e8e2f506
title: Hosts retain navigation restrictions across a channel or server restart
ord: 30
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18501-a14a-7319-9e56-55febacf0e35
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/contract/wire/host.ts
  - kind: symbol
    ref: apps/tagma/server/src/browser/pages.ts
    symbol: makePages
---
A desktop page can outlive its server and the action that protected it. Reconciliation, popup adoption and each policy acquisition therefore take the active-policy fact from the host, including existing related windows whose policy the acquisition changes. The host versions each restriction fact so an older input event delayed behind persistence cannot overwrite a newer admission. The core applies that projection before acquisition returns and tracks active or in-flight policies per profile, so an unrestricted opener cannot skip clearing a related window's restriction. Native input reports its locally applied changes without another host call; reconnecting itself does not end the policy.