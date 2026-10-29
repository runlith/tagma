---
id: 01a14828-1f15-7e60-8663-f3c1496f9eb4
title: CDP
ord: 26
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/wire.ts"
      },
      {
        "at": "src/session.ts"
      },
      {
        "at": "src/domains.ts"
      },
      {
        "at": "src/payload.ts"
      },
      {
        "at": "src/snapshot.ts"
      },
      {
        "at": "src/keys.ts"
      },
      {
        "at": "src/input.ts"
      },
      {
        "at": "src/ring.ts"
      },
      {
        "at": "src/describe.ts"
      },
      {
        "at": "src/probe.ts"
      },
      {
        "at": "src/pipe.ts"
      },
      {
        "at": "src/screencast.ts"
      },
      {
        "at": "src/stream.ts"
      }
    ],
    "id": "@runlith/cdp"
  }
edges:
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
sources:
  - kind: dir
    ref: packages/cdp
---
Runlith drives Chromium pages with its own engine, and this kit is what that engine stands on, knowing neither Tagma nor Electron: a CDP session over any text transport with answers by id, nested flatten sessions and a shared domain counter, a pipe transport split on NUL, large answers parsed off the event loop, cutting a screencast frame and images out of text without parsing, a compact accessibility-tree snapshot, the US key table, mouse input, a byte-bounded ring buffer, node description, and renderer responsiveness probing. Which page to drive, who holds it, and which refusals to give the agent is decided by the caller.
