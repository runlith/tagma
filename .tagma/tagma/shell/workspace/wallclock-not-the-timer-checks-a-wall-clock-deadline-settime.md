---
id: 01a12710-7375-79d3-b1f0-239094f5ae12
title: "WallClock, not the timer, checks a wall-clock deadline: setTimeout in Chromium runs on monotonic clocks"
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12702-e165-77f6-a642-4f18550cf08e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/WallClock.svelte.ts
---
The browser timer counts monotonic time, which stands still during sleep on macOS, and can fire before `Date.now()` reaches the target. So a wall-clock-set deadline (a provider cache window, `expiresAt`) is never awaited with one `setTimeout`: after sleep or an early firing, such a timer leaves the display in the past forever.

`WallClock.watchDeadline` checks every deadline against `Date.now()`. The alarm stands no more than a few seconds ahead, and deadlines re-check on window return (`visibilitychange`). A component needing a deadline subscribes to it and reads the clocks' `now`; it keeps no clocks of its own. Registration moves the alarm only when the new deadline is earlier than the current, so mounting many rows never costs quadratic work.
