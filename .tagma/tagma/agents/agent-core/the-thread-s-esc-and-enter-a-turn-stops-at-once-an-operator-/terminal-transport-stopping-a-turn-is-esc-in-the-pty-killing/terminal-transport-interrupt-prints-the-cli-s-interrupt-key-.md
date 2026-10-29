---
id: 01a15f39-3fc7-7e0f-9e9d-f30f424c2d22
title: "Terminal transport: interrupt prints the CLI's interrupt key in the PTY, the process lives, no silent success, one lane print queue"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f39-1d19-7756-a1b0-1ee4e73e2530",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d8d0f5ca7e
---
Implementation of [[d0f5ca7e]]: the terminal's interrupt is the CLI profile key through the host's input lane, with the receipt on the byte write; a stop does not kill the process; a turn missing from OpenRuns finds the session by facet; lane printing is one serialized queue; steer is declared from the profile probe.
