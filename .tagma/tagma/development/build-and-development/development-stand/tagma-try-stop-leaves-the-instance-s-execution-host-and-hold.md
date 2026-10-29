---
id: 01a13697-c0ea-7633-905f-c2cca1b6e4eb
title: tagma:try --stop leaves the instance's execution host and holder running
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "The answer was {\"stopped\": 16521} (the server). The instance's execution-holder (pid 51075, alive since an earlier instance two hours before) and its host bun with two child.ts workers kept running until killed by hand; each try restart over the same root also left the previous host alive.",
    "command": "bun run tagma:try --root /var/folders/.../T/load-try --port 7811 --stop --json",
    "expected": "The try instance is gone: its server, its execution host and its holder stop together, since the root is the agent's own throwaway instance."
  }
---
Filed from project `runlith`.

Found by `ps -axo pid,command | grep load-try` after the stop. A similar orphan of an older try root (tagma-compact-showcase, host pid 87182, 16 days old, ~469 CPU-minutes) is still running on this machine, so the leak outlives sessions.