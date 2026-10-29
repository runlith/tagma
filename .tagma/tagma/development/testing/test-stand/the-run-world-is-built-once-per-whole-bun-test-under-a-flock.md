---
id: 01a16ff7-61e7-7789-acb4-63137c0fd0a0
title: The run world is built once per whole bun test under a flock in the run root, giving workers only data
ord: 12
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16c03-89ef-7846-941b-d63682279b2b
sources:
  - kind: symbol
    ref: packages/testbed/src/worlds.ts
    symbol: once
  - kind: symbol
    ref: packages/testbed/src/worlds.ts
    symbol: runKind
---
A worker's world (`world`/`shared`) is rebuilt by every worker: under `--parallel=N` its cost is paid N times. What does not depend on a process — data on disk — is built once per whole `bun test` under a flock in the run root: `once(runKind(name, build), params)`.

- **Data only.** The build gets a directory and returns a serializable value; its scope closes right after the build. A process living in the run world would be one worker's process, which the others neither hold nor judge.
- **One builder.** The run world name is `<run root>/run-worlds/<sha256(key)>`, the key the kind's tag name and canonical JSON of parameters, as with a worker world. Whoever takes the `<name>.lock` flock builds; the rest wait for the lock to free and read the ready result. Readiness is a `<name>.json` pointer with directory and value, written last through rename.
- **Directory per attempt.** Each build writes into its own `<name>.<pid>.<random>` and never clears another's. A builder dying mid-build frees the lock with no pointer, but its child process (the bundle builder) may still write while the reaper removes it: a shared directory would hand the next builder a mixed layout.
- **Lifetime** is the run root: the `sweep` of the next run removes it. Under `--isolate` the run world is still built once, unlike the worker world. With no testbed (no run root) the directory is taken in the process's world home.
