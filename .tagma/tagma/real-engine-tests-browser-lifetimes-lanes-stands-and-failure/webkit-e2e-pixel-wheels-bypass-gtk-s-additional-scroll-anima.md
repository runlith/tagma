---
id: 01a1a80c-e309-7019-b40e-b034f81deeb4
title: WebKit e2e pixel wheels bypass GTK's additional scroll animation
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/e2e/src/engines.ts
---
The desktop wheel oracle compares a delivered pixel delta with its DOM displacement. GTK's coarse-wheel animator spreads that delta over later frames, so a direct pixel-wheel scenario would otherwise judge the embedder's interpolation rather than the feed. This startup option leaves Chromium touch flings and the native iOS lane's momentum unchanged.