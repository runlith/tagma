---
id: 01a0cf70-8db6-7877-9fee-457952791797
title: Commands could be held back by the machine's measured load instead of by counted slots
ord: 29
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a0cf38-b201-7723-b919-48c38cb4e34f
---
The command workload that [[8cb4e34f]] removes counted launches, measured nothing, and marked a command heavy only on the model's own choice. It enforced 48 ordinary commands at once and one `heavy` at a time among agents that picked `heavy`. The real problem is still standing: two 6-worker compiles once froze this machine, and agents launch commands in bursts. Once rules are enforced, the host's native reader walks every running command's process tree once a second. The same system calls can also carry each process's CPU time and resident memory: task info through `proc_pidinfo` on macOS, and `stat` on Linux. Admission, or a stop, could act on that measured pressure instead of on guesses. What would inform the choice: whether overload recurs after the queue is gone, which resource runs out first (memory or cores), and whether holding a start or stopping the newest work serves the user better.