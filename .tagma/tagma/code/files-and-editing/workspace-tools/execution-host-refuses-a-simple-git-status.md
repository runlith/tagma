---
id: 01a1986d-0608-7d56-b77f-0bedc9e2241a
title: Execution host refuses a simple git status
ord: 156
tags: ["reflection"]
fields:
  {
    "actual": "The host refused launch with terminal-ineligible: AdmissionClosed; read_terminals reported no held terminals, so the suggested session shell was unavailable.",
    "command": "bash {\"command\":\"git status\"}",
    "expected": "Run git status in the current checkout and return its output."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T18:41:42.483Z, from 7ac4dab4f.