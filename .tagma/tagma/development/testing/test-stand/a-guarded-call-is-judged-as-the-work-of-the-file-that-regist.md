---
id: 01a188a2-bf4c-7a25-9389-c3e0db681b3c
title: A guarded call is judged as the work of the file that registered the test or hook it descends from, not the file the worker runs now
ord: 26
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/testbed/src/core/bed.ts
  - kind: file
    ref: packages/testbed/src/bun.ts
---
Under `--no-isolate` a worker keeps a shared world alive across files, and its background work — a refresh pass, a watcher, a queue drained by a fiber the build forked — keeps spawning while the next file runs. Judged by the current file alone, such a spawn in a following unit file was refused as that file's call and charged to it as a leftover, so a resource file's world failed whichever unit file the worker happened to run next.

So the Bun binding runs every test and hook callback a file registers inside that file's async context, and the guard and the process watch read the author from it. Effect 4 fibers keep the async context of the fiber that forked them and restore it at each resume, so work forked by a world's build stays its builder's however long it runs; plain promises and timers carry it natively. A spawn whose author is another file is that file's: refused only if that file is a unit file, held like a world process and removed with the worker, never judged as the current file's leftover.

A call with no recorded author — module top level, runner internals, a callback the runtime enters from outside any async chain, every call under Vitest — falls back to the current file, as before. The wrapper keeps the callback's `length`, which Bun reads to tell a done-callback test. A `describe` body is left unwrapped: it runs at registration, its tests and hooks are wrapped one by one, and under Bun 1.4.4 a describe body run inside `AsyncLocalStorage.run` spun the worker at registration.