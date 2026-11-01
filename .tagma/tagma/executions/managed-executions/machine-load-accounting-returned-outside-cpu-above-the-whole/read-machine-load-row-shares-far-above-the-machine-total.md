---
id: 01a194fc-5161-7230-9870-8cf98b914b30
title: read_machine_load row shares far above the machine total
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "machine 28.5% busy, yet outside 785.2% and the WindowServer row 513.3%, fseventsd 80.0%.",
    "command": "read_machine_load({limit: 4})",
    "expected": "Row shares add up to at most the machine CPU share, as the tool description promises."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T02:30:59.745Z, from 2c34a6f95.

Earlier sighting, 2026-10-31 ~23:42Z, server instance 1e33b7f0, build 20261031T175000144Z, right after the server restarted (Tagma 16.0%). Likely the first interval after a sampler start divides cumulative process CPU by a short window; unverified.