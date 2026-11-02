---
id: 01a18ca9-b53e-77a7-8f24-62e99bfaa095
title: Machine load counts Tagma's own desktop window as an outside program
ord: 100
tags: ["reflection"]
fields:
  {
    "actual": "They are a separate row `program Tagma Dev` (15.0% of the machine, 3.1 GB) under outside; the installation row holds only server, host, holder and child processes, so the panel shows Tagma at ~11% while Tagma's own processes take ~26%.",
    "command": "read_machine_load {limit: 12}",
    "expected": "The Tagma Dev Electron processes (main, renderers, GPU, utility) are charged to the installation row with role window, as the operation's description promises."
  }
---
Filed from project `tagma`.

Reading at 2026-10-30 ~11:5xZ, 12-core Mac: machine 73.7% busy; installation 7.9% (server pid 27321 4.4%, host pid 18117 3.0%); agents 3.2%; `program Tagma Dev` 15.0% with pids 28497 (renderer), 28479 (gpu-process), 63353, 73220 (renderers), 28062 (Electron main), 28480 (network utility), all under ~/.tagma-dev/install/20261029T233526264Z/desktop/Tagma Dev.app. The server runs from ~/.tagma-dev/install/current/bun. No installation-row process carried role `window` in two consecutive readings. The operator read the Tagma panel ("Tagma 8.6%, Rest of the Mac" for the rest) as Tagma being blamed for almost none of an 80–94% load.