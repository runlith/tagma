---
id: 01a17aff-0013-783e-93b0-821b675351c0
title: Measuring keypress-to-echo latency of the terminal under machine saturation
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b25-1345-7ccf-82c8-ba112cc40277",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
  - kind: waits-on
    to: 01a17aff-0013-783e-93b0-821902ce39c8
---
The bench occupies every core with same-priority processes plus printing in several other terminals, and measures p50 and p99 from keypress to echo through the endpoint and for direct pty writes from an idle process. The numbers land in the spec as one sample, with machine and load.
