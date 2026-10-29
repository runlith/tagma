---
id: 01a0cac8-e5e7-745f-9873-a1895d7b2541
title: "Dimmed settings keys stay enabled and writable: dimmed is opacity-only"
ord: 3
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/KeyCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SettingRow.svelte
---
`dimmed` applies `opacity-50` and nothing else (`KeyCard.svelte:64`), while `SettingRow` disables on `busy || locked` alone (`SettingRow.svelte:105`) — dimmed is never consulted. So `graph.commit` off-team and `agent.contextFiles.names` with reading off render dimmed yet stay fully enabled and writable, contradicting their sections' own words ("nothing on this page acts on it", "stops being a live choice").

Disable what is dimmed (or stop dimming what stays live). Done when a dimmed control cannot be written, with a test pinning the dimmed-disabled pair.