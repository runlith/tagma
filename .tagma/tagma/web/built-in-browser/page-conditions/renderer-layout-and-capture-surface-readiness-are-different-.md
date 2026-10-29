---
id: 01a1869f-7a14-751e-aa30-d8a867de2527
title: Renderer layout and capture surface readiness are different facts
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1488e-00b0-7c56-9342-85df17a2e154
  - kind: relates
    to: 01a185e7-febb-7233-b05e-9d38d0baf766
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/automation.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/emulate.ts
---
A CDP metrics reply does not by itself establish the page's restored layout. Both hosts therefore retain the native size as a renderer fact while no override stands. An observed native resize invalidates the previous sample immediately; the first override uses a sample ordered after the drained resize events, not an older success while a background read is pending. Metric writes settle on an exact normalized size or an ordered resize fact; the page queue alone only orders browser commands. Dimensions are compared in full-widget DIPs because layout metrics exclude scrollbar gutters and mobile page scale otherwise changes their units. A viewer resize burst pays no surface-copy cost: the latest pending metrics are settled only before engine work needs geometry, or before emulation and attachment answer.

A post-write resize establishes a setter's renderer dimensions even when normalization does not exactly reproduce the requested size. On clear, a post-write resize to dimensions different from the measured pre-clear renderer size establishes restored native layout, including when native bounds changed silently under an override. Pre-write events are drained before recording the write's revision. An unchanged read finishes only if it already matches the expected size; otherwise it may still be the previous layout. The remaining no-event path is a normalized mismatch with no qualifying post-write resize, including an unchanged physical viewport whose normalized dimensions disagree with the target. That wait lasts until a matching read, a qualifying resize, page closure or engine-session end; normalization is not proven exact for every viewport meta, CSS zoom and gutter combination.

This establishes renderer layout for geometry reads, not the browser's hit-test surface. Capture therefore keeps its separate surface-copy transaction. Tagma's Electron and ordinary managed-Chromium macOS hosts use in-process Cocoa views: native restoration synchronously embeds the new parent surface generation, and their subsequent copy requires that generation or newer. The asynchronous remote-Cocoa counterexample needs an app-shim host that neither configuration supplies; the copy's surface-generation fence remains a different fact from this renderer-dimension match.