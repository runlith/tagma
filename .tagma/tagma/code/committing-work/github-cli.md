---
id: 01a0fd8b-bf13-7e86-86fd-2245f20c91d2
title: GitHub CLI
ord: 9
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/GitHubCli.ts",
        "for": [
          "c6922284",
          "9543a701",
          "13182a9f",
          "6cc306ce"
        ]
      }
    ],
    "id": "@runlith/github",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/github
---
Acts on the remote repository — pull requests and the like — Tagma performs through `gh`, and the package provides typed command launching. When and what to do on GitHub, the caller decides.
