---
id: 01a1a857-874e-7994-995e-c1ea9b58e594
title: A shown profile remembers its window size through the host's own window, which Chrome closes last
ord: 17
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/managed-browser/windows.ts
---
Chrome saves the placement of the last tabbed window to close and gives it to the first window of the next launch. Within a launch, a new window takes the size of the window last resized. In a shown profile the host's own `about:blank` window lives from launch to exit, so it is always the last to close. Left alone, it would make Chrome forget every size the user gave a page window. So the host copies each page window resize onto its own window: maximized, or the same bounds. `Page.frameResized` on the page's service session reports the resize, and no script runs in the page. The next launch opens the own window, and the page windows after it, at that size. Measured on Google Chrome 156, macOS, one sample: a maximized page window and one dragged to 1500×900 both came back after a restart. A window the user moved without resizing reports nothing, so its position is not kept.

Rejected: making the own target `hidden`, which would leave no extra window. With only a hidden target alive and no window open, `Target.createTarget` gave no answer for 10 s. With nothing at all open, the same call opened a window. Measured on Chrome 156.