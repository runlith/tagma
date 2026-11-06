---
id: 01a128d0-ffdd-77ae-af50-a6fe8b2e7319
title: macOS launches lowest through reversible BG, and serves children via Pacing.follow
ord: 2
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/execution-host/native/holder/src/macos/sys.rs
    symbol: tempo
  - kind: symbol
    ref: packages/execution-host/native/holder/src/posix/spawn.rs
    symbol: child
  - kind: symbol
    ref: packages/execution-host/src/Pacing.ts
    symbol: makePacing
---
The QoS clamp inherits on fork, but `setpriority(..., 0)` does not remove it: with it, lowest-born work would lose the rise to full that the former host kept. So lowest launch uses START_SUSPENDED and reversible Darwin BG; low keeps utility QoS. The children's tempo guarantee belongs to the assembled host: on a tempo change Pacing walks every proven set of each job the change shifts; a job the platform cannot shift stays at its level and is not walked. After each round ProcessWatch with a lowest target rechecks every live process and returns BG if someone else removed it. With other targets it touches only processes it has not walked yet, and only of a job that stood on lowest at least once: BG inherits on fork, so on a new process only BG inherited from a process the host itself lowered needs removing. Otherwise a host with a full target would remove BG that someone else set in its tree: e.g. a nested holder that launched the leader on lowest — right after launch, before the tempo check; and on recheck two hosts would reset each other's tempo forever. A job raised from lowest still raises a new process with its own BG from a nested host once; a nested host with a lowest target returns it on the next round. That a job stood on lowest is kept with its tempo: otherwise a job reopened after a logic change while already raised would stop raising lagging children the former logic had not yet found. The holder port confirms the leader's starting tempo, and the host contract the children's and the reverse rise.
