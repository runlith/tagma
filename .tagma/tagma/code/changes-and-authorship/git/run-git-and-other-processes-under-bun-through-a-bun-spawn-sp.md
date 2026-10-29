---
id: 01a12034-13e8-7d51-b4fd-bd53533303ef
title: Run git and other processes under Bun through a Bun.spawn spawner instead of the BunChildProcessSpawner Node layer
ord: 107
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1205b-eb84-7eac-af15-ef0b2d9fb386
  - kind: relates
    to: 01a1205b-eb84-7eac-af15-ef0da2afe539
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
  - kind: file
    ref: packages/executions/src/bunSpawner.ts
  - kind: file
    ref: packages/git/src/Git.ts
  - kind: file
    ref: packages/git/src/objects.ts
---
**Question.** Replace `BunChildProcessSpawner.layer` from `@effect/platform-bun` with one spawner over `Bun.spawn` everywhere Bun code starts processes.

**What stands.** In effect 4.0.1 `BunChildProcessSpawner` is a one-line re-export of `@effect/platform-node-shared/NodeChildProcessSpawner`: `node:child_process.spawn` and `node:stream` adapters over Bun emulation. Each of its waits rests on an event, and some waits have no timeout: start waits for `spawn` or `error`, scope close in a finalizer that cannot be interrupted waits for `exit`, reading and writing wait for `readable`/`end` and `drain`/`finish`. Places and conditions are in [[2d9fb386]]. A lost event leaves the wait forever, with no CPU. 18 files wire this layer: inspection workers (`spawnGit` and `ObjectSessions` from `@runlith/git`), checkout-files, graph, install and build, docker-sandbox, speech (`whisper`), `execution-host` (`PipeProcess`), `github`, `tsconfig`, `world/machine` in `agent-tools`. `apps/tagma/inspection/src/core/node/gitTrees.ts` calls `Bun.spawnSync`, but only CLI and inspection benches reach it: the built `bin/server/judge.worker.ts` install has no `spawnSync`; git there goes one way.

`bunSpawner` in `executions` implements the same Effect interface on `Bun.spawn`: a start error throws synchronously, exit is the `child.exited` promise, stdout and stderr are native `ReadableStream`, stdin is `write` and `flush()`. On POSIX workspace tools and inspection workers use it; on Windows both compositions keep the Node adapter to stop the process tree. In the native adapter there are no Node-stream event waits.

**What weakens this hypothesis.** In Bun 1.4.2 `node:child_process` is a shell over `Bun.spawn`: the binary holds `this.#handle = Bun.spawn({`. The `exit` event of the Node layer and the `exited` of `runtimeSpawner` come from one native exit notice — on macOS a kqueue. Open Bun bugs on macOS describe exactly this symptom: an exit notice is lost, `execFile` from `node:child_process` in a worker never finishes, streams stand in `kevent` (oven-sh/bun#41024, #39709). If that is the cause, moving to `Bun.spawn` does not remove it — only the `node:stream` adapter waits go. The move is justified as a simplification and as a streams-hypothesis check, but not as a fix for the hang.

**Edge of the shared adapter.** `bunSpawner` takes stdin as a Stream, wires pipelines and frees referenced processes on scope close with declared escalation. Shell and extra fds it refuses; an output sink in start options needs separate support too. The composition sets Default detached: inspection workers create own groups, workspace tools keep prior behaviour. Process cost stays in `executions`, and `git` gets only a neutral `ChildProcessSpawner`.

**What decides the choice.**
- Further wiring the adapter to the remaining Node layers needs reading their real options and lifecycle.
- Tests of `git`, `ripgrep`, `agent-tools`, `sandbox`, `speech-whisper` packages hold the wider replacement.
- The move bypasses the known Node-event loss under `bun test`; it does not establish the cause of the callback's own interruption inside Bun.

Related to [[a3cdb701]].
