---
id: 01a17d50-423c-74fb-8f1f-db8f0a1f3c8f
title: In the cost of a new host, an empty shell is a terminal launched as a login shell with that same shell in its foreground
ord: 10
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a17d2b-ffc2-717d-8c2a-e2e056ff6fb0
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/machineHost.ts
---
The new host's price names only what would be a pity to lose, so its rows tell a launched program from an empty shell by the pty foreground process the host answers (the terminal's foreground group), not by the program name.

- A foreground process matching the leader alone doesn't mean "empty": a terminal launched straight by a program (`bun run dev` with no shell) holds it in the foreground just as login shell holds itself at the prompt. So "empty shell" also requires a login-shell start — the terminal's command line equals `<program> -l`, how a program-less terminal starts.
- With another process in the foreground the row names its command line from the host process table: `vim plan.md`, not the tab's `zsh`.
- A foreground the host didn't read, and every host terminal of another build the server doesn't talk to, come as `unread`: they are neither named empty nor hidden.
- A terminal whose shell runs with other arguments (`bash -i`) reads as a program.
