---
id: 01a19222-30cc-7f51-a61f-79130ab5aec3
title: Machine load reports the active desktop application outside Tagma
ord: 101
tags: ["reflection"]
fields:
  {
    "actual": "The running desktop bundle appears as outside program Tagma Dev at 36.97% of machine CPU, while own totals show 3.24%; desktop and server both use installation 20261031T130902956Z.",
    "command": "read_machine_load({limit:12,json:true})",
    "expected": "The active Tagma desktop process and its Electron descendants contribute to the installation CPU and memory totals."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T13:10:51.924Z, from d26831727.

On this 12-core Mac, desktop PID 32437 and its GPU/renderer children belong to ~/.tagma-dev/install/20261031T130902956Z/desktop/Tagma Dev.app. The report puts 24 processes in that program row, with 7,366,477,184 memoryBytes. Server PID 32079 uses install/current and its children resolve to the same revision. The machine share was 56.64%; own share was 3.24%. The report also returns unread: projects: not-found: project 39 does not exist. Native ps independently confirms busy Electron children. This is a read-only CPU diagnosis; no process was stopped and no settings changed.