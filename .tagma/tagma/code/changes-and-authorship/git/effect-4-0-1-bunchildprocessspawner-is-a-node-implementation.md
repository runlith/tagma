---
id: 01a1205b-eb84-7eac-af15-ef0b2d9fb386
title: "Effect 4.0.1: BunChildProcessSpawner is a Node implementation, and its process-event and stream waits have no timeout"
ord: 108
tags: ["research"]
fields:
  {
    "source": {
      "name": "effect",
      "ref": "4.0.1 (@effect/platform-bun, @effect/platform-node-shared)"
    }
  }
---
Sources `.external/effect` read at tag `effect@4.0.1`: `packages/platform/bun/src/BunChildProcessSpawner.ts`, `packages/platform/node-shared/src/NodeChildProcessSpawner.ts`, `internal/nodeChildProcessSpawner.ts`, `NodeStream.ts`, `NodeSink.ts`.

**What the reading establishes.**
- `BunChildProcessSpawner.ts` whole: `export * from "@effect/platform-node-shared/NodeChildProcessSpawner"`. The package has no own implementation on Bun: the process is started by `node:child_process.spawn`, streams led by `node:stream` adapters.
- `detached` defaults `true` everywhere except Windows: the process heads its own group.
- Start is `Effect.callback` continuing on `spawn` (success) or `error` (refusal). No timeout.
- Exit: a `Deferred` fulfilled on `exit`; `exitCode` and `isRunning` stand on it.
- Scope close (release of `acquireRelease`): if the process has not exited yet, `terminateProcessGroup` signals the group, polls its life to `forceKillAfter` (1 s when unset), signals `SIGKILL` when needed and waits 1 s more, then `Deferred.await(exitSignal)` — waiting for the `exit` event with no timeout. Scope finalizers cannot be interrupted, so this wait holds the whole close.
- stdout and stderr: the process stream is piped into a `PassThrough` read by `readableToPullUnsafe`: `read()` returned `null` — with no `end` or `error` the latch closes and waits for `readable` or `end` events. No timeout.
- stdin: `pullIntoWritable` writes, on `write() === false` waits for `drain`; when the source ends, calls `end()` and waits for `finish` if the stream is not closed yet. No timeout; a write error races with the `error` event.
- A process exiting non-zero is signalled to its own group right in the `exit` handler.

**What the reading does not establish.** Whether the `node:child_process` and `node:stream` emulation in Bun loses any of these events. Separate probes on Bun 1.4.2 found no losses ([[d9aef9cf]]). The `Deferred.await(exitSignal)` chain in a finalizer is dangerous by construction — it could not be checked against a live hang.
