---
id: 01a14a0a-7246-713a-aeb9-807b98524b53
title: The Load panel shows the Tagma server as a nameless "bun 27846", and folds the CPU of the git processes it reaped into its figure with no mark
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The row is labelled \"bun 27846 43 %\"; the operator could not tell what process it was or who started it. Per proc_pid_rusage over the same 20 s: own CPU 0.33 cores, reaped children 1.18 cores; over 10 minutes of life 364 s vs 1650 s. Children are mostly `git status --untracked-files=all`",
    "command": "Tagma Dev → the \"Tagma and its agents\" panel (CPU) / read_machine_load({limit: 14}) — process row pid 27846",
    "expected": "The server row is named by the server (`tagma serve`), and the process's own CPU is shown separately from the CPU of the short-lived children it already reaped (git status and others), so it is visible what loads the machine"
  }
---
Filed from project `runlith`.

The with-children count is deliberate (explanation 4f7c55d5): work born and finished between passes is charged to the parent. But the surface shows none of it: the panel has only the executable name and pid, no command line or role, while read_machine_load returns the command `.../bin/cli/main.js serve`, and the row's cpu share is about 4× the process's own CPU (top: 100% of one core vs share 0.38 of 12 cores).

Cost: the operator could not identify the load source and asked to investigate; the agent needed ps, top, ctypes reads of proc_pid_rusage and a sample of spawned processes to separate the server from its git children (70 git processes in 15 s).
