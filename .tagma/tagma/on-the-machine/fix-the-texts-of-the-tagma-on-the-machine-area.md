---
id: 01a14c37-8e48-71fa-9f64-f41fa7578df0
title: Fix the texts of the “Tagma on the machine” area
ord: 31
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
- The `tagma desktop` help promises one window and waiting for an externally started server; `tagma web` — waiting with a bound; `tagma serve` — that no CLI stops the server. The code does the opposite.
- Explanation 1210860c names `build_checkout`/`stop_build` instead of `install_next`/`stop_installing`.
- Explanation 9e8adf53 describes returning WAL/SHM before the main file; `trial.ts#returned` puts the main one first — check both the order and its safety.
- Explanation 514eda53: restart does not lose a started entry (flow-cookie).
- Card 0645e048 does not name the Gmail/Workspace boundary from `googleProvider.identify`.
