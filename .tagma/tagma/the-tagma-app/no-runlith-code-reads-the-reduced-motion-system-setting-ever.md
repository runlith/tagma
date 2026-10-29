---
id: 01a0d2f9-2be6-73c0-9d9f-13e077135f8f
title: "No runlith code reads the reduced-motion system setting: every animation runs unconditionally"
ord: 53
tags: ["rule"]
fields:
  {
    "delivery": "code",
    "enabled": true
  }
sources:
  - kind: dir
    ref: apps
  - kind: dir
    ref: packages
  - kind: dir
    ref: scripts
---
In apps, packages and scripts, prefers-reduced-motion in CSS and matchMedia, Tailwind motion-reduce:/motion-safe: and helpers reading the setting are forbidden. Unneeded animation removed or reworked. Captured bench/*/index.html are recordings and excluded. Check: node scripts/checkMotion.mjs.
