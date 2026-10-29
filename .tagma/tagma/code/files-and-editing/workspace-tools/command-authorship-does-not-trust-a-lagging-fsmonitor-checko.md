---
id: 01a16e1f-6cfe-7eb9-a78d-a27672cded3d
title: "Command authorship does not trust a lagging fsmonitor: checkout snapshots before and after the command see a tracked edit the monitor stays silent about"
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dfb-d3b1-7a0c-8a44-11413b9da093",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16dfa-c8a7-7d17-a5df-7016e4b563f1
sources:
  - kind: file
    ref: packages/agent-tools/src/checkoutState.ts
---
`checkoutState.ts` takes `git status` before and after the command with the monitor, and `ShellRun.ts` derives `movedPaths` only from paths that status named. Under load fsmonitor lags by tens of seconds: a tracked file the command changed or deleted lands in neither snapshot. Then the command gets neither lines nor an observation, and Holdings will never restore its authorship.

Reading status for named paths without the monitor (`statusAt` with `monitor: false`, 0169f13a5e) does not fit here on its own: the command's snapshot is a full-tree status, and turning the monitor off on every command means stat-walking the whole index. Decide which paths to confirm without the monitor: for example, paths the file watcher marked inside the command's window, or tracked paths from the process-record window. The decision must keep the snapshot's cost in large repositories.
