---
id: 01a1795c-fd9d-74f3-a778-1b0ee983c0ec
title: The tempo contracts' isolated holder is a launchd task with ProcessType Interactive, and full tempo is checked against the holder's own priority
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/testing/isolated.ts
---
The tempo contracts' holder launches outside the process tree where the test runs: the outer host that launched the test command would otherwise move its children's tempo. Outside that tree launchd gives birth to it. launchd puts light resource limits on a task with no `ProcessType`, including one filed via `launchctl submit`. Then the holder's children on `full` run no higher than on `low` (QoS utility), and the "`full` does not demote the child" contract stops differing from `low`. launchd promises `ProcessType` Interactive with no background throttling. Measurement on macOS 2026-10-26, `ps -o pri`: a `submit` task — 20, like `low`; Interactive — 31, like an ordinary process.

`full` means "the child runs at its launcher's priority", so the reference is the holder's priority, not the test process's. The test process may itself stand on the outer host's or the CI runner's lowered tempo, which the isolated holder does not inherit.
