---
id: 01a194b3-5756-74b5-b537-c07d2b3a9de1
title: tagma:build installs a shared checkout's uncommitted peer work, and the agent cannot step back from it
ord: 60
tags: ["reflection"]
fields:
  {
    "actual": "It built the working tree as `12b23011a-dirty` with 40 uncommitted paths of other running agents (half-done Holdings worker move, history store, invocation, app wire) and swapped install/current onto it; `--back` then refused operator-only, so a crash or restart would start unreviewed code.",
    "command": "bun run tagma:build --no-restart (cwd /Users/teunlao/runlith/tagma, main checkout shared by ~20 agents)",
    "expected": "A build from a checkout other sessions hold uncommitted lines in builds committed HEAD, or refuses naming those lines, before swapping `current`."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

Install 20261101T011658702Z, 2026-11-01 ~01:17Z. The output marks the build `-dirty` but does not stop. The workaround was a detached Tagma worktree at HEAD and a second build from it with `--origin` naming the main checkout. The change record already knows which sessions hold uncommitted lines in the checkout, so the build could tell its own landed state from peers' in-flight work.