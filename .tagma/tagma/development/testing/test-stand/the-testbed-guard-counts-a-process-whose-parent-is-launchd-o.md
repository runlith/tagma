---
id: 01a17be6-9a44-7b53-b915-7bca404e7e7c
title: The testbed guard counts a process whose parent is launchd or already invisible as an orphan, not only with `ppid` 1
ord: 16
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/core/watch.ts
---
macOS hides an exiting process from `proc_pidinfo` before closing its files, and reparents its children to launchd only after the files close. So a test that read a helper's stdout to EOF may reach the verdict at once while the helper's daemon still names the already invisible process as parent. Counting only `ppid === 1` as orphans, such a daemon falls into neither the process group nor the born orphans, the verdict's first scan is empty, and the file that left the daemon passes guilt-free.

Under load the window lasts longer than the path from EOF to the verdict's first scan. So a process born since the file start whose parent is invisible to the `Processes` port counts as an orphan both in suspect selection and in the cwd check of mark-less lines.

The window is closed for the `darwin` adapter (Bun on macOS). The `ps` adapter (Node on macOS) itself gives `born` only launchd children, and on Linux an exiting process stays visible in `/proc` until it reparents children and is not marked zombie; there this window is neither closed nor measured.

A parent nobody sees may still be a living process of another user held by the test; so ancestor walk admits a held parent's pid even with no line for it in the table.
