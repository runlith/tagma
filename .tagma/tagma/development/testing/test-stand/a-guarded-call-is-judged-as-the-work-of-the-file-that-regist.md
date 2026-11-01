---
id: 01a188a2-bf4c-7a25-9389-c3e0db681b3c
title: A guarded call is judged as the work of the file that registered the test or hook it descends from, not the file the worker runs now
ord: 26
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/bun.ts
  - kind: file
    ref: packages/testbed/src/core/bed.ts
---
Under `--no-isolate` a worker keeps a shared world alive across files, and its background work — a refresh pass, a watcher, a queue drained by a fiber the build forked — keeps spawning while the next file runs. Judged by the current file alone, such a spawn in a following unit file was refused as that file's call and charged to it as a leftover, so a resource file's world failed whichever unit file the worker happened to run next.

So the Bun binding runs every test and hook callback a file registers inside that file's async context, and a shared world's build runs inside a world origin (`building` in the fixture) naming the file that built it; the guard and the process watch read the origin. Effect 4 fibers keep the async context of the fiber that forked them and restore it at each resume, so work forked by a world's build stays world work however long it runs; plain promises and timers carry it natively. The guard refuses a call only when its author is a unit file. Authorship and lifetime stay apart: only world work is held and removed with the worker. Any other late spawn — an unawaited continuation a test left behind — is judged as a leftover in the verdict of the file running when it appears, and the message names the file that started it.

A call with no recorded author — module top level, runner internals, a callback the runtime enters from outside any async chain, every call under Vitest — falls back to the current file, as before. The wrapper keeps the callback's `length`, which Bun reads to tell a done-callback test. A `describe` body is left unwrapped: it runs at registration, its tests and hooks are wrapped one by one, and under Bun 1.4.4 a describe body run inside `AsyncLocalStorage.run` spun the worker at registration.

Bun 1.4.4 can leave an `onTestFinished` hook waiting after its callback returned when the hook was registered in an async context. The preload registers it in its own context and runs its callback in the registering context, retaining authorship without holding the runner open.